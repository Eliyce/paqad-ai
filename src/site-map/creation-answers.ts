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

export function canonicalAnswersPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_CANONICAL_ANSWERS);
}

export function emptyCreationAnswers(): SiteMapAnswersFile {
  return { schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION, generated_by: 'paqad-ai', answers: [] };
}

export function readCreationAnswers(projectRoot: string): SiteMapAnswersFile | null {
  const parsed = readYaml(canonicalAnswersPath(projectRoot));
  if (parsed === null) return null;
  return validateSiteMapAnswers(parsed).valid ? (parsed as SiteMapAnswersFile) : null;
}

export function writeCreationAnswers(projectRoot: string, file: SiteMapAnswersFile): string {
  const result = validateSiteMapAnswers(file);
  if (!result.valid) {
    throw new SiteMapSchemaError('creation answers failed schema validation', result.errors);
  }
  return writeYamlAtomic(canonicalAnswersPath(projectRoot), file);
}

function normalizeAnchors(anchors: string[]): string[] {
  return [...anchors].sort();
}

function anchorsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = normalizeAnchors(a);
  const right = normalizeAnchors(b);
  return left.every((value, index) => value === right[index]);
}

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

export function provenanceOf(answer: SiteMapAnswer): AnswerProvenance {
  return answer.decided_by === 'human'
    ? { derivation: 'human', confidence: 'high' }
    : { derivation: 'agent', confidence: 'low' };
}

function collectAnchors(refs: Array<EvidenceRef | undefined>): string[] {
  const anchors = new Set<string>();
  for (const ref of refs) {
    for (const pointer of normalizeEvidence(ref)) anchors.add(locate(pointer));
  }
  return [...anchors].sort();
}

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

const DERIVATION_AUTHORITY: Record<Derivation, number> = {
  agent: 0,
  convention: 1,
  static: 2,
  human: 3,
};
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function provenanceRank(p: { derivation?: Derivation; confidence?: Confidence }): [number, number] {
  return [
    p.derivation === undefined ? -1 : DERIVATION_AUTHORITY[p.derivation],
    p.confidence === undefined ? -1 : CONFIDENCE_RANK[p.confidence],
  ];
}

function isStronger(
  a: { derivation?: Derivation; confidence?: Confidence },
  b: { derivation?: Derivation; confidence?: Confidence },
): boolean {
  const [ad, ac] = provenanceRank(a);
  const [bd, bc] = provenanceRank(b);
  return ad > bd || (ad === bd && ac > bc);
}

const SURFACE_CATEGORIES: ReadonlySet<SiteMapAnswerCategory> = new Set([
  'grouping',
  'labels-language',
  'sensitive-surface',
]);

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

export interface StampedProvenance {
  map: AppMap;
  changed: boolean;
}

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
