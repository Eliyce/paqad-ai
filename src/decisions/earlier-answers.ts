import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { jaccard } from '@/duplication/token-similarity.js';
import { normalizeDecisionQuestion } from '@/planning/decision-fingerprint.js';
import {
  isStrictDecisionId,
  type DecisionPacket,
  type DecisionSuggestion,
  type EarlierCheck,
} from '@/planning/decision-packet.js';
import { readResolvedPackets } from '@/planning/decision-precedents.js';

import { readAnyDecisionPacket } from './packet-shape.js';

export const EARLIER_SCORE_FLOOR = 0.5;
export const EARLIER_LIMIT = 5;

export const PRIVATE_ANSWER_CATEGORIES: readonly string[] = [
  'authoring.override',
  'authoring.agent_permission',
  'authoring.risky_script',
  'analytics.pii_consent',
];

export interface EarlierQuestionQuery {
  question: string;
  excludeId?: string;
  category?: string;
  now?: Date;
}

export interface EarlierCandidate {
  id: string;
  category: string;
  question: string;
  context: string;
  chosen: string;
  chosen_label: string;
  why: string;
  resolved_at: string;
}

export interface EarlierQuestion extends EarlierCandidate {
  score: number;
}

function questionWords(question: string): Set<string> {
  return new Set(normalizeDecisionQuestion(question).split(' ').filter(Boolean));
}

function isCandidate(packet: DecisionPacket, query: EarlierQuestionQuery, now: number): boolean {
  if (packet.decision_id === query.excludeId) return false;
  if (packet.status !== 'resolved' && packet.status !== 'delegated') return false;
  if (!packet.human_response?.chosen_option_key) return false;
  if (Date.parse(packet.ttl_until) < now) return false;
  return !PRIVATE_ANSWER_CATEGORIES.includes(packet.category) || packet.category === query.category;
}

function toCandidate(packet: DecisionPacket): EarlierCandidate {
  const response = packet.human_response!;
  const chosen = response.chosen_option_key!;
  return {
    id: packet.decision_id,
    category: packet.category,
    question: packet.question,
    context: packet.context,
    chosen,
    chosen_label: packet.options.find((option) => option.option_key === chosen)!.label,
    why: response.note?.trim() ?? '',
    resolved_at: response.responded_at,
  };
}

function compareBestFirst(left: EarlierQuestion, right: EarlierQuestion): number {
  if (left.score !== right.score) return right.score - left.score;
  const byTime = Date.parse(right.resolved_at) - Date.parse(left.resolved_at);
  return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
}

export function findEarlierQuestions(
  projectRoot: string,
  query: EarlierQuestionQuery,
): EarlierQuestion[] {
  const words = questionWords(query.question);
  if (words.size === 0) return [];
  const now = (query.now ?? new Date()).getTime();
  return readResolvedPackets(projectRoot)
    .filter((packet) => isCandidate(packet, query, now))
    .map((packet) => ({
      ...toCandidate(packet),
      score: jaccard(words, questionWords(packet.question)),
    }))
    .filter((earlier) => earlier.score >= EARLIER_SCORE_FLOOR)
    .sort(compareBestFirst)
    .slice(0, EARLIER_LIMIT);
}

export function earlierCheckFor(
  projectRoot: string,
  query: EarlierQuestionQuery,
): EarlierCheck | null {
  try {
    const found = findEarlierQuestions(projectRoot, query);
    if (found.length === 0) return null;
    return { status: 'required', candidates: found.map((earlier) => earlier.id) };
  } catch {
    return null;
  }
}

const METHOD_RELATIVE_PATH = 'base/skills/decision/references/earlier-answers.md';

export const EARLIER_METHOD_FALLBACK =
  'Compare the earlier reason with the situation now, treat shared wording as no evidence, and answer --none when unsure.';

export function readEarlierMethod(runtimeRoot: string = getRuntimeRoot()): string {
  try {
    const text = readFileSync(join(runtimeRoot, METHOD_RELATIVE_PATH), 'utf8').trim();
    return text === '' ? EARLIER_METHOD_FALLBACK : text;
  } catch {
    return EARLIER_METHOD_FALLBACK;
  }
}

export interface StoredPendingPacket {
  id?: string;
  decision_id?: string;
  category: string;
  title?: string;
  question?: string;
  options: { option_key: string; label: string }[];
  recommendation?: string | null;
  earlier_check?: EarlierCheck;
  suggestion?: DecisionSuggestion;
}

function pendingFile(projectRoot: string, id: string): string {
  return join(projectRoot, PATHS.DECISIONS_PENDING_DIR, `${id}.json`);
}

function readPendingFile(projectRoot: string, id: string): StoredPendingPacket | null {
  if (!isStrictDecisionId(id) || !existsSync(pendingFile(projectRoot, id))) return null;
  return JSON.parse(readFileSync(pendingFile(projectRoot, id), 'utf8')) as StoredPendingPacket;
}

export function earlierCheckRefusal(id: string): string {
  return `This question has earlier answers to check first. Run paqad-ai decision check ${id}.`;
}

export function assertEarlierCheckDone(projectRoot: string, id: string): void {
  if (readPendingFile(projectRoot, id)?.earlier_check?.status === 'required') {
    throw new Error(earlierCheckRefusal(id));
  }
}

export interface EarlierCheckBlock {
  required: true;
  candidates: EarlierCandidate[];
  missing?: string[];
  method: string;
  next: string;
}

function readCandidate(projectRoot: string, id: string): EarlierCandidate | null {
  const path = join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`);
  try {
    const packet = readAnyDecisionPacket(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (!packet?.human_response?.chosen_option_key) return null;
    return toCandidate(packet);
  } catch {
    return null;
  }
}

export function earlierCheckBlock(
  projectRoot: string,
  id: string,
  check: EarlierCheck,
): EarlierCheckBlock {
  const candidates: EarlierCandidate[] = [];
  const missing: string[] = [];
  for (const candidateId of check.candidates) {
    const candidate = readCandidate(projectRoot, candidateId);
    if (candidate) candidates.push(candidate);
    else missing.push(candidateId);
  }
  return {
    required: true,
    candidates,
    ...(missing.length > 0 ? { missing } : {}),
    method: readEarlierMethod(),
    next: `paqad-ai decision suggest ${id} --earlier <D-id> --option <key> --reason <text>, or --none --reason <text>`,
  };
}

export interface QuestionEntry {
  label: string;
  option_key: string;
  resolve: string;
}

export interface QuestionBlock {
  question: string;
  options: QuestionEntry[];
  other: string;
}

export const MAX_QUESTION_ENTRIES = 4;

function shellArg(value: string): string {
  return /^[\w:.@/=-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

function resolveCommand(id: string, key: string): string {
  return `paqad-ai decision resolve ${id} ${shellArg(key)}`;
}

export function buildQuestionBlock(id: string, packet: StoredPendingPacket): QuestionBlock {
  return {
    question: packet.title ?? packet.question ?? '',
    options: packet.options.slice(0, MAX_QUESTION_ENTRIES).map((option) => ({
      label: option.label,
      option_key: option.option_key,
      resolve: resolveCommand(id, option.option_key),
    })),
    other: `paqad-ai decision resolve ${id} other --other "<text>"`,
  };
}

export type DecisionCheckOutput =
  | { id: string; earlier_check: EarlierCheckBlock }
  | { id: string; earlier_check: { required: false }; question: QuestionBlock };

export function checkDecision(projectRoot: string, id: string): DecisionCheckOutput {
  const packet = readPendingFile(projectRoot, id);
  if (packet === null) {
    const resolved =
      isStrictDecisionId(id) &&
      existsSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`));
    throw new Error(
      resolved ? `Decision ${id} is already resolved.` : `Decision ${id} was not found.`,
    );
  }
  if (packet.earlier_check?.status === 'required') {
    return { id, earlier_check: earlierCheckBlock(projectRoot, id, packet.earlier_check) };
  }
  return { id, earlier_check: { required: false }, question: buildQuestionBlock(id, packet) };
}

export interface PendingCreateResult {
  id: string;
  path: string;
}

export interface PendingCreateOutput extends PendingCreateResult {
  earlier_check?: EarlierCheckBlock;
}

export function formatCreateOutput(
  projectRoot: string,
  result: PendingCreateResult,
): PendingCreateOutput {
  const check = readPendingFile(projectRoot, result.id)?.earlier_check;
  if (!check) return { id: result.id, path: result.path };
  return {
    id: result.id,
    path: result.path,
    earlier_check: earlierCheckBlock(projectRoot, result.id, check),
  };
}
