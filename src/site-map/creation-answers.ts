// The persisted site-map creation-answers store plus the pure logic that keeps one-step
// creation minimal and honest (issue #466, Part A). The single creation action and the actual
// asking are AI-driven at author time; this module is the offline seam around them:
//
//  - the store persists the person's decisions to `docs/site-map/answers.yaml` (OSC-18), reusing
//    the same atomic-write and tolerant-read discipline as the map store so a corrupt file reads
//    as absent and a schema-invalid file is never written;
//  - `reconcileQuestions` decides, against those persisted answers, what still needs asking, so a
//    re-creation or documentation-sync does not re-ask a settled question and asks as few times
//    as possible (OSC-9), while any question whose motivating code changed is reopened (OSC-18);
//  - `recordAnswers` folds newly decided answers back in idempotently for a stable diff;
//  - `provenanceOf` maps an answer onto a map element's provenance, so a human decision earns
//    normal confidence and a default earns reduced confidence and is visibly not user-confirmed
//    (OSC-14/OSC-19);
//  - `stampAnswerProvenance` is the write-back: it stamps that provenance onto the surfaces each
//    answer settled, so a defaulted grouping/label decision is visibly not user-confirmed on the
//    map element itself, monotonically (never downgrading a stronger fact) and idempotently.
//
// Everything here is pure or a validated store; nothing runs at view time, and nothing runs while
// the `site_map` flag is off (the creation flow that calls it is flag- and prerequisite-gated).

import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  SITE_MAP_ANSWERS_SCHEMA_VERSION,
  type AnswerProvenance,
  type CandidateQuestion,
  type QuestionReconciliation,
  type SiteMapAnswer,
  type SiteMapAnswerCategory,
  type SiteMapAnswersFile,
} from '@/core/types/site-map-answers.js';
import type {
  AppMap,
  Confidence,
  Derivation,
  EvidenceRef,
  Surface,
} from '@/core/types/site-map.js';
import type { PreflightResult } from '@/workflow-preflight/contract.js';

import { validateSiteMapAnswers } from './schema.js';
import { SiteMapSchemaError, readYaml, writeYamlAtomic } from './store.js';
import { locate, normalizeEvidence } from './verification.js';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Absolute path to the persisted creation-answers artifact (`docs/site-map/answers.yaml`). */
export function canonicalAnswersPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_CANONICAL_ANSWERS);
}

/** An empty, valid answers document — the starting point when none exists on disk. */
export function emptyCreationAnswers(): SiteMapAnswersFile {
  return { schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION, generated_by: 'paqad-ai', answers: [] };
}

/**
 * Read the persisted answers, or null when absent / corrupt / schema-invalid. Degrading to null
 * keeps a bad file from crashing the creation flow and from being trusted; the flow simply treats
 * the project as having no prior answers and re-offers every question.
 */
export function readCreationAnswers(projectRoot: string): SiteMapAnswersFile | null {
  const parsed = readYaml(canonicalAnswersPath(projectRoot));
  if (parsed === null) return null;
  return validateSiteMapAnswers(parsed).valid ? (parsed as SiteMapAnswersFile) : null;
}

/**
 * Persist the answers atomically, after validating them. Throws {@link SiteMapSchemaError} on an
 * invalid file so a bad shape is never written (matching the map/journey writers). Returns the
 * written path.
 */
export function writeCreationAnswers(projectRoot: string, file: SiteMapAnswersFile): string {
  const result = validateSiteMapAnswers(file);
  if (!result.valid) {
    throw new SiteMapSchemaError('creation answers failed schema validation', result.errors);
  }
  return writeYamlAtomic(canonicalAnswersPath(projectRoot), file);
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** A copy of the anchors sorted, so anchor sets compare independent of order. */
function normalizeAnchors(anchors: string[]): string[] {
  return [...anchors].sort();
}

/** Whether two anchor sets are equal as sets-in-order (both normalized before comparison). */
function anchorsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = normalizeAnchors(a);
  const right = normalizeAnchors(b);
  return left.every((value, index) => value === right[index]);
}

/**
 * Decide which candidate questions still need asking, against the persisted answers (OSC-18).
 * A persisted answer is reused only when a person decided it and the code anchors that motivated
 * it are unchanged; otherwise the question is asked again. A persisted default is never reused, so
 * the person always gets the chance to confirm it. A human answer whose anchors moved is reopened
 * (re-asked and reported in `reopened`), so a settled fact is never silently applied to code it no
 * longer describes.
 */
export function reconcileQuestions(
  candidates: CandidateQuestion[],
  persisted: SiteMapAnswersFile | null,
): QuestionReconciliation {
  const byId = new Map<string, SiteMapAnswer>();
  for (const answer of persisted?.answers ?? []) {
    byId.set(answer.question_id, answer);
  }

  const to_ask: CandidateQuestion[] = [];
  const reused: SiteMapAnswer[] = [];
  const reopened: string[] = [];

  for (const candidate of candidates) {
    const prior = byId.get(candidate.question_id);
    if (prior !== undefined && prior.decided_by === 'human') {
      if (anchorsEqual(prior.anchors, candidate.anchors)) {
        reused.push(prior);
      } else {
        to_ask.push(candidate);
        reopened.push(candidate.question_id);
      }
    } else {
      to_ask.push(candidate);
    }
  }

  return { to_ask, reused, reopened };
}

/**
 * Fold newly decided answers into the persisted set (upsert by question_id, newest wins), then
 * return a fresh, valid file with answers sorted by id so the on-disk diff stays stable. Anchors
 * are normalized so re-recording an unchanged answer is a byte-for-byte no-op.
 */
export function recordAnswers(
  persisted: SiteMapAnswersFile | null,
  decided: SiteMapAnswer[],
): SiteMapAnswersFile {
  const byId = new Map<string, SiteMapAnswer>();
  for (const answer of persisted?.answers ?? []) {
    byId.set(answer.question_id, { ...answer, anchors: normalizeAnchors(answer.anchors) });
  }
  for (const answer of decided) {
    byId.set(answer.question_id, { ...answer, anchors: normalizeAnchors(answer.anchors) });
  }
  const answers = [...byId.values()].sort((a, b) => a.question_id.localeCompare(b.question_id));
  return { schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION, generated_by: 'paqad-ai', answers };
}

/**
 * Map a persisted answer onto the provenance a map element derived from it should carry. A human
 * decision earns normal (high) confidence and `human` derivation, so the element reads as
 * user-confirmed (OSC-19). A default earns reduced (low) confidence and `agent` derivation, so a
 * defaulted element is visibly not user-confirmed (OSC-14).
 */
export function provenanceOf(answer: SiteMapAnswer): AnswerProvenance {
  return answer.decided_by === 'human'
    ? { derivation: 'human', confidence: 'high' }
    : { derivation: 'agent', confidence: 'low' };
}

/** The sorted, deduped `file:line` anchors an element set cites, in the map's own anchor form. */
function collectAnchors(refs: Array<EvidenceRef | undefined>): string[] {
  const anchors = new Set<string>();
  for (const ref of refs) {
    for (const pointer of normalizeEvidence(ref)) anchors.add(locate(pointer));
  }
  return [...anchors].sort();
}

/**
 * Derive the reduced set of creation-time questions from an assembled map (issue #466, Part A,
 * the deferred author-time seam). The AI-driven flow batches these through `AskUserQuestion`, then
 * feeds the answers into {@link reconcileQuestions} so a settled one is not re-asked. The rules:
 *
 *  - Stay inside the closed OSC-16 categories, and emit a question ONLY when the map itself shows
 *    the ambiguity deterministically, so a fully-authored map yields `[]` (nothing to ask, OSC-9):
 *      - `grouping`         — surfaces with no `area`, so the map has no district for them.
 *      - `actors-roles`     — guards are defined but no actors name who satisfies them.
 *      - `journey-priority` — journeys are still `proposed`, awaiting a human call on which matter.
 *      - `labels-language`  — a surface still shows its i18n key instead of a resolved human label.
 *  - Attach the current `file:line` anchors that motivate each question, so `reconcileQuestions`
 *    reopens it when that code moves (OSC-18) rather than silently reusing a stale answer.
 *  - Carry a recommended default with its reason, so the person can accept quickly (OSC-10).
 *
 * At most one question per category, so the asked set is small and nothing is ever silently
 * dropped. Pure over the map; the caller is flag- and prerequisite-gated (INV-1).
 */
export function buildCandidateQuestions(map: AppMap): CandidateQuestion[] {
  const candidates: CandidateQuestion[] = [];

  const ungrouped = map.surfaces.filter((surface) => surface.area === undefined);
  if (ungrouped.length > 0) {
    candidates.push({
      question_id: 'grouping:ungrouped-surfaces',
      category: 'grouping',
      question: `${ungrouped.length} surface(s) are not assigned to an area, so the map has no district for them. How should they be grouped?`,
      anchors: collectAnchors(ungrouped.map((surface) => surface.evidence)),
      recommended_default: {
        answer: 'group-by-module',
        reason: 'Group each ungrouped surface under the module it already belongs to.',
      },
    });
  }

  const guards = map.guards ?? [];
  const actors = map.actors ?? [];
  if (guards.length > 0 && actors.length === 0) {
    candidates.push({
      question_id: 'actors-roles:no-actors',
      category: 'actors-roles',
      question: `The map defines ${guards.length} guard(s) but names no actors. Who uses the app, and which guards does each satisfy?`,
      anchors: collectAnchors(guards.map((guard) => guard.evidence)),
      recommended_default: {
        answer: 'single-authenticated-user',
        reason:
          'Assume one signed-in user who satisfies every guard until distinct roles are named.',
      },
    });
  }

  const proposed = (map.journeys ?? []).filter((journey) => journey.status === 'proposed');
  if (proposed.length > 0) {
    candidates.push({
      question_id: 'journey-priority:proposed',
      category: 'journey-priority',
      question: `${proposed.length} journey(s) are still proposed. Which are real, and which matter most?`,
      anchors: [],
      recommended_default: {
        answer: 'keep-all-proposed',
        reason: 'Keep every proposed journey until a person deprioritizes one.',
      },
    });
  }

  const keyed = map.surfaces.filter(
    (surface) =>
      surface.label_key !== undefined &&
      (surface.labels === undefined || surface.label === surface.label_key),
  );
  if (keyed.length > 0) {
    candidates.push({
      question_id: 'labels-language:keyed-labels',
      category: 'labels-language',
      question: `${keyed.length} surface(s) show a translation key instead of a human label. Which label should the map display?`,
      anchors: collectAnchors(keyed.map((surface) => surface.evidence)),
      recommended_default: {
        answer: 'default-locale-label',
        reason: "Resolve each key against the app's default locale catalog.",
      },
    });
  }

  return candidates;
}

/**
 * Project a preflight result into creation-time candidate questions, so a preflight decision (for
 * example how to obtain a project command's output — DEC-1) is asked and persisted through the same
 * answer store as the map's own questions, rather than a second file (S3c, D5/D6). Only
 * `command`-kind requirements become questions, under the `tool-access` category, because those are
 * the ones about reaching a command's output.
 *
 * The probe outcome is baked into the `question_id` (`tool-access:<requirement-id>:<outcome>`) so
 * that {@link reconcileQuestions} reuses a settled answer while the probe result is unchanged and
 * re-asks it when the probe result changes (for example PHP appears or disappears) — the answer
 * carries `anchors: []` because it describes tooling, not code, so the usual code-anchor reopening
 * does not apply. Pure over its input.
 */
export function buildPreflightQuestions(preflight: PreflightResult): CandidateQuestion[] {
  const commandIds = new Set(
    preflight.requirements.filter((requirement) => requirement.kind === 'command').map((r) => r.id),
  );
  return preflight.questions
    .filter((question) => commandIds.has(question.id))
    .map((question) => {
      const recommended =
        question.options.find((option) => option.recommended) ?? question.options[0]!;
      return {
        question_id: `tool-access:${question.id}:${question.outcome}`,
        category: 'tool-access' as const,
        question: `${question.label}: ${question.why}`,
        anchors: [],
        recommended_default: { answer: recommended.id, reason: recommended.label },
      };
    });
}

// ---------------------------------------------------------------------------
// Provenance stamp (issue #466, Part A — the deferred author-time write-back)
// ---------------------------------------------------------------------------

// Rank each provenance component by how *authoritative* it is, lowest-to-highest, so a stamp only
// ever raises an element and never erases a stronger existing fact. This is deliberately NOT the
// `DERIVATIONS` enum's declaration order (`static, convention, agent, human`, which no code ranks
// by): an `agent` value is the LLM/default's own guess and is the LEAST trustworthy, so it must sit
// below a deterministic `static` extraction and a `convention` match. A person (`human`) is top.
// The upshot: a human answer confirms any element, and a default answer (`agent`/low, per
// provenanceOf) only fills a blank element and can never downgrade a static or convention fact to a
// guess. Confidence is the tiebreak within one derivation: low < medium < high.
const DERIVATION_AUTHORITY: Record<Derivation, number> = {
  agent: 0,
  convention: 1,
  static: 2,
  human: 3,
};
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** An absent component ranks below every present one, so any real provenance raises a bare element. */
function provenanceRank(p: { derivation?: Derivation; confidence?: Confidence }): [number, number] {
  return [
    p.derivation === undefined ? -1 : DERIVATION_AUTHORITY[p.derivation],
    p.confidence === undefined ? -1 : CONFIDENCE_RANK[p.confidence],
  ];
}

/** Whether `a` is strictly stronger provenance than `b` (derivation first, then confidence). */
function isStronger(
  a: { derivation?: Derivation; confidence?: Confidence },
  b: { derivation?: Derivation; confidence?: Confidence },
): boolean {
  const [ad, ac] = provenanceRank(a);
  const [bd, bc] = provenanceRank(b);
  return ad > bd || (ad === bd && ac > bc);
}

/**
 * The closed set of answer categories that decide something about a *surface* (OSC-16). Only these
 * may stamp a surface's provenance, so an `actors-roles` answer (which is about guards) can never
 * bleed its provenance onto a surface that happens to share a code anchor. `app-kind` is app-level
 * and `journey-priority` names no per-element provenance slot, so both are excluded here.
 */
const SURFACE_CATEGORIES: ReadonlySet<SiteMapAnswerCategory> = new Set([
  'grouping',
  'labels-language',
  'sensitive-surface',
]);

/**
 * The strongest provenance a set of persisted answers grants an element citing `anchors`, or null
 * when none applies. An answer motivates the element only when the answer is in `categories`, cites
 * at least one anchor, and its anchor set *covers* the element's whole (non-empty) anchor set — so
 * the element is genuinely among the ones that answer settled, not a coincidental single-anchor
 * overlap. A human answer outranks a default (via {@link provenanceOf}), so the strongest wins.
 */
function motivatingProvenance(
  anchors: string[],
  answers: SiteMapAnswer[],
  categories: ReadonlySet<SiteMapAnswerCategory>,
): AnswerProvenance | null {
  if (anchors.length === 0) return null;
  let best: AnswerProvenance | null = null;
  for (const answer of answers) {
    if (!categories.has(answer.category) || answer.anchors.length === 0) continue;
    const cover = new Set(answer.anchors);
    if (!anchors.every((anchor) => cover.has(anchor))) continue;
    const provenance = provenanceOf(answer);
    if (best === null || isStronger(provenance, best)) best = provenance;
  }
  return best;
}

/** The result of stamping answer provenance onto a map: the (possibly rewritten) map and whether it moved. */
export interface StampedProvenance {
  map: AppMap;
  changed: boolean;
}

/**
 * Stamp each persisted creation-answer's provenance onto the map elements it settled (issue #466,
 * Part A — the write-back the OSC honesty seam was built toward). `provenanceOf` already maps a
 * human answer to {@link Derivation `human`}/high confidence and a documented default to `agent`/low;
 * this is the pure function that writes that pair back onto the map, so a defaulted grouping or label
 * decision is *visibly* not user-confirmed (OSC-14) and a human one reads confirmed (OSC-19, INV-3).
 *
 * Only **surfaces** are stamped: a surface is the one map element carrying the full
 * `{derivation, confidence}` pair, and every surface-deciding category (`grouping`,
 * `labels-language`, `sensitive-surface`) targets it. Guards carry their honesty in the `trust`
 * tier (added in C1) with no derivation/confidence slot, transitions carry only confidence with no
 * category that decides them, and journey index entries carry neither — so all three are left
 * untouched, and the durable record of *who* decided every answer still lives in `answers.yaml`.
 *
 * The stamp is monotonic (it only ever raises a surface to a stronger provenance, never downgrades a
 * stronger static/convention fact) and idempotent (re-stamping an unchanged map over unchanged
 * answers rewrites nothing, so `changed` is false and the bytes are identical). An unchanged surface
 * keeps its original object and key order. Pure over its inputs; the caller is flag- and
 * prerequisite-gated (INV-1).
 */
export function stampAnswerProvenance(map: AppMap, answers: SiteMapAnswer[]): StampedProvenance {
  let changed = false;

  const surfaces = map.surfaces.map((surface) => {
    const anchors = collectAnchors([surface.evidence]);
    const provenance = motivatingProvenance(anchors, answers, SURFACE_CATEGORIES);
    if (provenance === null || !isStronger(provenance, surface)) return surface;
    changed = true;
    return { ...surface, derivation: provenance.derivation, confidence: provenance.confidence };
  });

  if (!changed) return { map, changed: false };
  return { map: { ...map, surfaces: surfaces as Surface[] }, changed: true };
}
