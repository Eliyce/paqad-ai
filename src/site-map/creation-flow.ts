import {
  SITE_MAP_ANSWER_CATEGORIES,
  type AnswerDecidedBy,
  type CandidateQuestion,
  type QuestionReconciliation,
  type SiteMapAnswer,
} from '@/core/types/site-map-answers.js';
import type { PreflightResult } from '@/workflow-preflight/contract.js';

import {
  buildCandidateQuestions,
  buildPreflightQuestions,
  reconcileQuestions,
  readCreationAnswers,
  recordAnswers,
  stampAnswerProvenance,
  writeCreationAnswers,
} from './creation-answers.js';
import { readCanonicalSiteMap, writeCanonicalSiteMap } from './store.js';

export type CreationQuestionsResult =
  { status: 'no-map' } | { status: 'ready'; reconciliation: QuestionReconciliation };

export function deriveCreationQuestions(projectRoot: string): CreationQuestionsResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) return { status: 'no-map' };
  const reconciliation = reconcileQuestions(
    buildCandidateQuestions(map),
    readCreationAnswers(projectRoot),
  );
  return { status: 'ready', reconciliation };
}

export interface CreationDecision {
  question_id: string;
  answer: string;
  decided_by: AnswerDecidedBy;
}

export type RecordCreationResult =
  | { status: 'no-map' }
  | {
      status: 'recorded';
      recorded: number;
      unknown: string[];
      answers_path: string | null;
      stamped: boolean;
      map_path: string | null;
    };

export function recordCreationAnswers(
  projectRoot: string,
  decisions: CreationDecision[],
  preflight?: PreflightResult,
): RecordCreationResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null && preflight === undefined) return { status: 'no-map' };

  const candidates = new Map<string, CandidateQuestion>();
  if (map !== null) {
    for (const candidate of buildCandidateQuestions(map))
      candidates.set(candidate.question_id, candidate);
  }
  if (preflight !== undefined) {
    for (const candidate of buildPreflightQuestions(preflight)) {
      candidates.set(candidate.question_id, candidate);
    }
  }
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

  if (map === null) {
    return {
      status: 'recorded',
      recorded: decided.length,
      unknown,
      answers_path,
      stamped: false,
      map_path: null,
    };
  }

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

const VALID_DECIDED_BY: ReadonlySet<string> = new Set<AnswerDecidedBy>(['human', 'default']);
const VALID_CATEGORY: ReadonlySet<string> = new Set(SITE_MAP_ANSWER_CATEGORIES);

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
