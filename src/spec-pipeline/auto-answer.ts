// S2 ledger auto-answer — the deterministic, zero-token question filter (issue #517, FR-4.5).
//
// Before any clarification question reaches the user, the pipeline checks it against the
// decisions ledger: a match injects the recorded answer with its source and the question
// never appears. This is a PURE filesystem lookup — paqad calls no LLM from Node (INV-1), so
// this function is synchronous and imports no inference client; a sync function structurally
// cannot make a model call (AC-2).
//
// Two ledger seams are consulted per question, in order (decision D-01M1PY6HTZB0QYYNCVRMRGR3RZ):
//   1. exact/fingerprint reuse — `findIntakePriorMatch`, which fingerprints a synthesized
//      intake.requirement packet and asks `DecisionStore.findReusableDecision`;
//   2. advisory textual precedent — `findDecisionPrecedents`, accepted only above a high score
//      floor so a weak match never silently answers for the user.
// The rule seam (`resolveByCompiledRule`) is deliberately NOT wired: it is file-glob-triggered
// and cannot meaningfully choose among plain-language outcome options.

import { readProjectProfile } from '@/core/project-profile.js';
import type { ActiveCapability } from '@/core/types/domain.js';
import type { DecisionOption } from '@/planning/decision-packet.js';
import { findDecisionPrecedents } from '@/planning/decision-precedents.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { buildRepoStateForIntake, findIntakePriorMatch } from '@/planning/intake-prior-resolver.js';

import type { AutoAnswer, PipelineQuestion } from './types.js';

/**
 * Minimum precedent score to auto-answer from an advisory textual match ("only when
 * confidence is high", FR-4.5). `scorePrecedent` gives 0.5 for a same-category match plus up
 * to 0.5 for token overlap, so this floor admits only same-category questions with strong
 * (>= 0.4 Jaccard) textual overlap — never a weak or cross-topic guess.
 */
export const PRECEDENT_ACCEPT_FLOOR = 0.7;

export interface AutoAnswerResult {
  /** Questions the ledger answered, each with its injected answer and source (FR-1). */
  answered: AutoAnswer[];
  /** The surviving batch to hand to the user (ledger-answerable questions removed). */
  remaining: PipelineQuestion[];
}

/** Deterministic option_key for a plain-language option string (stable, lowercase slug). */
function optionKey(option: string): string {
  return option
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build the synthesized decision options the fingerprint/reuse lookup keys on. */
function synthesizeOptions(question: PipelineQuestion): DecisionOption[] {
  return question.options.map((option) => ({
    option_key: optionKey(option),
    label: option,
    one_line_preview: option,
    trade_off: '',
    evidence: {},
  }));
}

/** The repo-state signature the fingerprint uses, derived deterministically from the profile. */
function repoStateFor(projectRoot: string): ReturnType<typeof buildRepoStateForIntake> {
  const profile = readProjectProfile(projectRoot);
  const stack = profile?.stack_profile?.frameworks?.join('+') || null;
  return buildRepoStateForIntake(
    (profile?.active_capabilities as ActiveCapability[] | undefined) ?? [],
    stack,
    undefined,
  );
}

/** Exact/fingerprint reuse seam — a prior resolved decision that answers the same question. */
function answerFromReuse(
  projectRoot: string,
  question: PipelineQuestion,
  options: DecisionOption[],
  store: DecisionStore,
): AutoAnswer | null {
  const match = findIntakePriorMatch(projectRoot, {
    category: 'intake.requirement',
    question: question.business_text,
    options,
    repoState: repoStateFor(projectRoot),
  });
  if (!match) {
    return null;
  }
  const prior = store.readResolved(match.priorDecisionId);
  const answer =
    prior?.options.find((option) => option.option_key === match.chosenOptionKey)?.label ??
    /* v8 ignore next -- findIntakePriorMatch only returns a valid chosen key on a readable prior */
    match.chosenOptionKey;
  return { question: question.business_text, answer, source: match.priorDecisionId };
}

/** Advisory textual precedent seam — the strongest prior decision, only above the floor. */
function answerFromPrecedent(projectRoot: string, question: PipelineQuestion): AutoAnswer | null {
  const context = [question.why_it_matters, ...question.options].join(' ');
  const precedents = findDecisionPrecedents(
    projectRoot,
    { category: 'intake.requirement', question: question.business_text, context },
    { floor: PRECEDENT_ACCEPT_FLOOR, limit: 1 },
  );
  const top = precedents[0];
  if (!top) {
    return null;
  }
  // `findDecisionPrecedents` only surfaces packets that recorded a choice, so `top.chosen` is
  // never null here; the guard is defensive.
  /* v8 ignore next 3 */
  if (top.chosen === null) {
    return null;
  }
  return { question: question.business_text, answer: top.chosen, source: top.decision_id };
}

/**
 * Filter a candidate question batch against the decisions ledger (issue #517, FR-4.5).
 * Deterministic and model-free: every answered question carries its ledger source, and any
 * question the ledger cannot answer is returned untouched in `remaining` for the user.
 */
export function autoAnswerQuestions(
  projectRoot: string,
  questions: PipelineQuestion[],
): AutoAnswerResult {
  const store = new DecisionStore(projectRoot);
  const answered: AutoAnswer[] = [];
  const remaining: PipelineQuestion[] = [];

  for (const question of questions) {
    const options = synthesizeOptions(question);
    const hit =
      answerFromReuse(projectRoot, question, options, store) ??
      answerFromPrecedent(projectRoot, question);
    if (hit) {
      answered.push(hit);
    } else {
      remaining.push(question);
    }
  }

  return { answered, remaining };
}
