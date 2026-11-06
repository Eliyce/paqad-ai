import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { ulid } from '@/core/ids/ulid.js';
import { recordDecisionReuse } from '@/decision-reuse/index.js';
import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';

import { foldQuestionText, NO_STANDING_ANSWER_CATEGORIES } from './earlier-answers.js';
import { isDecisionCategory } from './packet-shape.js';

export interface StandingAnswer {
  id: string;
  category: string;
  fingerprint: string;
  question: string;
  chosen: string;
  from_decision: string;
  created_at: string;
}

export interface StandingQuestion {
  category: string;
  question: string;
  optionKeys: readonly string[];
}

const MIN_FINGERPRINT_OPTIONS = 2;
const MAX_FINGERPRINT_OPTIONS = 5;

export const STANDING_FILE_UNREADABLE = `${PATHS.DECISIONS_STANDING_ANSWERS} cannot be read. Fix or remove the file first; it was not changed.`;

function standingPath(projectRoot: string): string {
  return join(projectRoot, PATHS.DECISIONS_STANDING_ANSWERS);
}

function isStandingAnswer(value: unknown): value is StandingAnswer {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Record<string, unknown>;
  return [
    'id',
    'category',
    'fingerprint',
    'question',
    'chosen',
    'from_decision',
    'created_at',
  ].every((key) => typeof rule[key] === 'string');
}

function readRules(projectRoot: string): StandingAnswer[] | null {
  if (!existsSync(standingPath(projectRoot))) return [];
  try {
    const parsed = JSON.parse(readFileSync(standingPath(projectRoot), 'utf8')) as {
      rules?: unknown;
    };
    return Array.isArray(parsed.rules) ? parsed.rules.filter(isStandingAnswer) : null;
  } catch {
    return null;
  }
}

function writeRules(projectRoot: string, rules: StandingAnswer[]): void {
  const path = standingPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify({ rules }, null, 2)}\n`);
  renameWithRetrySync(tempPath, path);
}

function recordRuleRow(
  projectRoot: string,
  kind: 'standing-set' | 'standing-removed',
  rule: StandingAnswer,
): void {
  recordDecisionReuse(projectRoot, {
    kind,
    decisionId: rule.from_decision,
    category: rule.category,
    chosenOptionKey: rule.chosen,
    ruleId: rule.id,
  });
}

export function isStandingFileReadable(projectRoot: string): boolean {
  return readRules(projectRoot) !== null;
}

export function listStandingAnswers(projectRoot: string): StandingAnswer[] {
  const rules = readRules(projectRoot);
  if (rules === null) throw new Error(STANDING_FILE_UNREADABLE);
  return rules;
}

function sameText(left: string, right: string): boolean {
  return foldQuestionText(left) === foldQuestionText(right);
}

function fingerprintFor(question: StandingQuestion): string | null {
  const count = question.optionKeys.length;
  if (
    !isDecisionCategory(question.category) ||
    count < MIN_FINGERPRINT_OPTIONS ||
    count > MAX_FINGERPRINT_OPTIONS
  ) {
    return null;
  }
  return computeDecisionFingerprint({
    category: question.category,
    question: question.question,
    option_keys: [...question.optionKeys],
    repo_state: {},
  });
}

export function findStandingAnswer(
  projectRoot: string,
  question: StandingQuestion,
): StandingAnswer | null {
  if (NO_STANDING_ANSWER_CATEGORIES.includes(question.category)) return null;
  const fingerprint = fingerprintFor(question);
  if (fingerprint === null) return null;
  const rules = readRules(projectRoot) ?? [];
  return (
    rules.find(
      (rule) =>
        rule.category === question.category &&
        rule.fingerprint === fingerprint &&
        sameText(rule.question, question.question) &&
        question.optionKeys.includes(rule.chosen),
    ) ?? null
  );
}

export function addStandingAnswer(
  projectRoot: string,
  input: StandingQuestion & { chosen: string; fromDecision: string },
): StandingAnswer {
  const rules = listStandingAnswers(projectRoot);
  const fingerprint = fingerprintFor(input);
  if (fingerprint === null) {
    throw new Error(`A standing answer cannot apply to ${input.fromDecision}.`);
  }
  const rule: StandingAnswer = {
    id: `R-${ulid()}`,
    category: input.category,
    fingerprint,
    question: input.question,
    chosen: input.chosen,
    from_decision: input.fromDecision,
    created_at: new Date().toISOString(),
  };
  const kept = rules.filter(
    (existing) =>
      existing.category !== rule.category ||
      existing.fingerprint !== rule.fingerprint ||
      !sameText(existing.question, rule.question),
  );
  writeRules(projectRoot, [...kept, rule]);
  recordRuleRow(projectRoot, 'standing-set', rule);
  return rule;
}

export function removeStandingAnswer(projectRoot: string, id: string): StandingAnswer {
  const rules = listStandingAnswers(projectRoot);
  const rule = rules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`Standing answer ${id} was not found.`);
  writeRules(
    projectRoot,
    rules.filter((candidate) => candidate.id !== id),
  );
  recordRuleRow(projectRoot, 'standing-removed', rule);
  return rule;
}

export function assertNotStageAgent(
  action: string,
  agentId: string | undefined = process.env.SE_AGENT_ID,
): void {
  if (agentId?.trim()) {
    throw new Error(
      `A stage agent cannot ${action}. Only the main conversation or the person can do this.`,
    );
  }
}
