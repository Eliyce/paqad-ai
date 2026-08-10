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
//    (OSC-14/OSC-19).
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
  type SiteMapAnswersFile,
} from '@/core/types/site-map-answers.js';

import { validateSiteMapAnswers } from './schema.js';
import { SiteMapSchemaError, readYaml, writeYamlAtomic } from './store.js';

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
