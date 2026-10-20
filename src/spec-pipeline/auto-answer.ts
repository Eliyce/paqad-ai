import { readProjectProfile } from '@/core/project-profile.js';
import type { ActiveCapability } from '@/core/types/domain.js';
import type { DecisionOption } from '@/planning/decision-packet.js';
import { findDecisionPrecedents } from '@/planning/decision-precedents.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { buildRepoStateForIntake, findIntakePriorMatch } from '@/planning/intake-prior-resolver.js';

import type { AutoAnswer, PipelineQuestion } from './types.js';

export const PRECEDENT_ACCEPT_FLOOR = 0.7;

export interface AutoAnswerResult {
  answered: AutoAnswer[];
  remaining: PipelineQuestion[];
}

function optionKey(option: string): string {
  return option
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function synthesizeOptions(question: PipelineQuestion): DecisionOption[] {
  return question.options.map((option) => ({
    option_key: optionKey(option),
    label: option,
    one_line_preview: option,
    trade_off: '',
    evidence: {},
  }));
}

function repoStateFor(projectRoot: string): ReturnType<typeof buildRepoStateForIntake> {
  const profile = readProjectProfile(projectRoot);
  const stack = profile?.stack_profile?.frameworks?.join('+') || null;
  return buildRepoStateForIntake(
    (profile?.active_capabilities as ActiveCapability[] | undefined) ?? [],
    stack,
    undefined,
  );
}

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
  /* v8 ignore next 3 */
  if (top.chosen === null) {
    return null;
  }
  return { question: question.business_text, answer: top.chosen, source: top.decision_id };
}

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
