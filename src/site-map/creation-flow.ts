// The one-step site-map creation flow (issue #466, Part A — C6a). The single creation action
// and the actual asking are AI-driven at author time; this module is the deterministic seam the
// agent drives around the host question UI, so the flow stays minimal, repeatable, and honest:
//
//  - `deriveCreationQuestions` reads the authored map plus the persisted answers and returns the
//    closed-list questions still to ask this run (`to_ask`), the human answers reused as-is, and
//    the ones reopened because their code moved. A map that is fully authored yields no questions;
//    an absent map yields a `no-map` result, never a fabricated question.
//  - `recordCreationAnswers` takes the person's decisions back, re-derives each question's category
//    and current `file:line` anchors from the map itself (never from agent-supplied text), persists
//    them to `docs/site-map/answers.yaml`, and stamps their provenance onto the map in one step, so
//    a defaulted decision reads as a low-confidence guess and a human one reads confirmed.
//  - `parseCreationDecisions` validates the agent's decision JSON before any of that runs.
//
// Everything composes the existing `creation-answers` seams and the canonical map store; it adds no
// new question or anchor logic. Nothing runs at view time, and nothing runs while the `site_map`
// flag is off (the CLI that calls it is flag- and prerequisite-gated).

import {
  SITE_MAP_ANSWER_CATEGORIES,
  type AnswerDecidedBy,
  type QuestionReconciliation,
  type SiteMapAnswer,
} from '@/core/types/site-map-answers.js';

import {
  buildCandidateQuestions,
  reconcileQuestions,
  readCreationAnswers,
  recordAnswers,
  stampAnswerProvenance,
  writeCreationAnswers,
} from './creation-answers.js';
import { readCanonicalSiteMap, writeCanonicalSiteMap } from './store.js';

// ---------------------------------------------------------------------------
// Derive the questions still to ask
// ---------------------------------------------------------------------------

/**
 * The reconciliation of the map's open questions against the persisted answers, or `no-map` when no
 * authored map exists yet (so the caller asks nothing rather than inventing questions).
 */
export type CreationQuestionsResult =
  { status: 'no-map' } | { status: 'ready'; reconciliation: QuestionReconciliation };

/**
 * Derive the creation questions the authored map still needs answered, reconciled against the
 * persisted answers so a settled human answer is not re-asked and a question whose motivating code
 * moved is reopened (OSC-9/OSC-18). Reads the canonical map and answers; returns `no-map` when the
 * map is absent. Pure composition over the `creation-answers` seams; the caller is flag-gated.
 */
export function deriveCreationQuestions(projectRoot: string): CreationQuestionsResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) return { status: 'no-map' };
  const reconciliation = reconcileQuestions(
    buildCandidateQuestions(map),
    readCreationAnswers(projectRoot),
  );
  return { status: 'ready', reconciliation };
}

// ---------------------------------------------------------------------------
// Record the decisions the person made
// ---------------------------------------------------------------------------

/**
 * One decision the agent brings back from the host question UI. Only the question's identity and
 * the chosen value are supplied; the category and the motivating `file:line` anchors are re-derived
 * from the map, so the persisted answer's anchors always match live code (OSC-18) and can never be
 * a stale or fabricated value the agent typed.
 */
export interface CreationDecision {
  /** The candidate question's stable id (from `deriveCreationQuestions`'s `to_ask`). */
  question_id: string;
  /** The chosen value (an option id or free text). */
  answer: string;
  /** Whether a person decided it (`human`) or it fell to the documented default (`default`). */
  decided_by: AnswerDecidedBy;
}

/** The outcome of recording a batch of creation decisions. */
export type RecordCreationResult =
  | { status: 'no-map' }
  | {
      status: 'recorded';
      /** How many decisions matched a current candidate and were persisted. */
      recorded: number;
      /** Decision ids with no current candidate (stale or unknown); skipped, never persisted. */
      unknown: string[];
      /** Absolute path of the persisted answers file, or null when nothing was written. */
      answers_path: string | null;
      /** Whether the provenance stamp rewrote the map. */
      stamped: boolean;
      /** Absolute path of the rewritten map, set only when `stamped` is true. */
      map_path: string | null;
    };

/**
 * Record the person's creation decisions and stamp their provenance onto the map in one step
 * (OSC-14/OSC-18/OSC-19). Each decision is matched to a current candidate question by id; the
 * category, plain-language question, and `file:line` anchors come from the map (via
 * `buildCandidateQuestions`), never from the agent, so a persisted answer always describes live
 * code. A decision whose id is not a current candidate is stale and is reported under `unknown`,
 * never persisted. When at least one decision matches, the reconciled answers are written to
 * `docs/site-map/answers.yaml` and `stampAnswerProvenance` writes each decision's provenance onto
 * the surfaces it settled, rewriting the map only when the stamp changed it. Returns `no-map` when
 * the map is absent. Pure composition; the caller is flag-gated.
 */
export function recordCreationAnswers(
  projectRoot: string,
  decisions: CreationDecision[],
): RecordCreationResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) return { status: 'no-map' };

  const candidates = new Map(buildCandidateQuestions(map).map((c) => [c.question_id, c]));
  const decided: SiteMapAnswer[] = [];
  const unknown: string[] = [];
  for (const decision of decisions) {
    const candidate = candidates.get(decision.question_id);
    if (candidate === undefined) {
      unknown.push(decision.question_id);
      continue;
    }
    decided.push({
      question_id: candidate.question_id,
      category: candidate.category,
      question: candidate.question,
      answer: decision.answer,
      decided_by: decision.decided_by,
      anchors: candidate.anchors,
    });
  }

  // Nothing matched a live question — leave docs/site-map/ untouched rather than writing an empty
  // or unchanged answers file, so a stale batch is a no-op.
  if (decided.length === 0) {
    return {
      status: 'recorded',
      recorded: 0,
      unknown,
      answers_path: null,
      stamped: false,
      map_path: null,
    };
  }

  const file = recordAnswers(readCreationAnswers(projectRoot), decided);
  const answers_path = writeCreationAnswers(projectRoot, file);

  const { map: stampedMap, changed } = stampAnswerProvenance(map, file.answers);
  const map_path = changed ? writeCanonicalSiteMap(projectRoot, stampedMap) : null;

  return {
    status: 'recorded',
    recorded: decided.length,
    unknown,
    answers_path,
    stamped: changed,
    map_path,
  };
}

// ---------------------------------------------------------------------------
// Parse the agent's decision input
// ---------------------------------------------------------------------------

const VALID_DECIDED_BY: ReadonlySet<string> = new Set<AnswerDecidedBy>(['human', 'default']);
const VALID_CATEGORY: ReadonlySet<string> = new Set(SITE_MAP_ANSWER_CATEGORIES);

/**
 * Parse and shape-validate the agent's creation decisions from a JSON string: a top-level array of
 * `{ question_id, answer, decided_by }`, each a non-empty string with `decided_by` one of `human` /
 * `default`. Throws a plain `Error` with a specific reason on any malformed input, so the CLI can
 * refuse a bad batch loudly instead of persisting garbage. A `category` field, if present, is
 * validated against the closed list but otherwise ignored (the category is re-derived from the map).
 */
export function parseCreationDecisions(raw: string): CreationDecision[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('decisions input is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('decisions input must be a JSON array of { question_id, answer, decided_by }');
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`decision ${index} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const { question_id, answer, decided_by, category } = record;
    if (typeof question_id !== 'string' || question_id.length === 0) {
      throw new Error(`decision ${index} needs a non-empty "question_id"`);
    }
    if (typeof answer !== 'string' || answer.length === 0) {
      throw new Error(`decision ${index} needs a non-empty "answer"`);
    }
    if (typeof decided_by !== 'string' || !VALID_DECIDED_BY.has(decided_by)) {
      throw new Error(`decision ${index} "decided_by" must be "human" or "default"`);
    }
    if (category !== undefined && (typeof category !== 'string' || !VALID_CATEGORY.has(category))) {
      throw new Error(`decision ${index} has an unknown "category"`);
    }
    return { question_id, answer, decided_by: decided_by as AnswerDecidedBy };
  });
}
