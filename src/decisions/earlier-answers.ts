import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { recordDecisionReuse } from '@/decision-reuse/index.js';
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
export const EARLIER_TITLE_LIMIT = 200;
export const EARLIER_TITLE_MAX_CHARS = 140;
export const EARLIER_METHOD_MAX_CHARS = 2000;
export const EARLIER_OUTPUT_MAX_CHARS = 24000;

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

export interface EarlierTitleQuery {
  excludeId?: string;
  category?: string;
  now?: Date;
}

export interface EarlierTitle {
  id: string;
  category: string;
  question: string;
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

export function foldQuestionText(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/gu, ' ');
}

function questionWords(question: string): Set<string> {
  return new Set(normalizeDecisionQuestion(question).split(' ').filter(Boolean));
}

function mayBeOffered(packet: DecisionPacket, query: EarlierTitleQuery): boolean {
  if (packet.decision_id === query.excludeId) return false;
  if (packet.status !== 'resolved' && packet.status !== 'delegated') return false;
  if (!packet.human_response?.chosen_option_key) return false;
  return !PRIVATE_ANSWER_CATEGORIES.includes(packet.category) || packet.category === query.category;
}

function sameQuestionKey(packet: DecisionPacket): string {
  const optionKeys = packet.options.map((option) => option.option_key).sort();
  return JSON.stringify([foldQuestionText(packet.question), optionKeys]);
}

function isNewerAnswer(packet: DecisionPacket, held: DecisionPacket): boolean {
  const byTime =
    Date.parse(packet.human_response!.responded_at) - Date.parse(held.human_response!.responded_at);
  return byTime !== 0 ? byTime > 0 : packet.decision_id > held.decision_id;
}

function newestOfEachQuestion(packets: DecisionPacket[]): DecisionPacket[] {
  const newest = new Map<string, DecisionPacket>();
  for (const packet of packets) {
    const key = sameQuestionKey(packet);
    const held = newest.get(key);
    if (held === undefined || isNewerAnswer(packet, held)) newest.set(key, packet);
  }
  return [...newest.values()];
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

function eligiblePackets(projectRoot: string, query: EarlierTitleQuery): DecisionPacket[] {
  const now = (query.now ?? new Date()).getTime();
  const offered = readResolvedPackets(projectRoot).filter((packet) => mayBeOffered(packet, query));
  return newestOfEachQuestion(offered).filter((packet) => Date.parse(packet.ttl_until) >= now);
}

export function findEarlierQuestions(
  projectRoot: string,
  query: EarlierQuestionQuery,
): EarlierQuestion[] {
  const words = questionWords(query.question);
  if (words.size === 0) return [];
  return eligiblePackets(projectRoot, query)
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

function eligibleTitles(projectRoot: string, query: EarlierTitleQuery): EarlierTitle[] {
  return eligiblePackets(projectRoot, query)
    .sort((left, right) => (isNewerAnswer(left, right) ? -1 : 1))
    .map((packet) => ({
      id: packet.decision_id,
      category: packet.category,
      question: packet.question,
    }));
}

export function listEarlierTitles(projectRoot: string, query: EarlierTitleQuery): EarlierTitle[] {
  return eligibleTitles(projectRoot, query).slice(0, EARLIER_TITLE_LIMIT);
}

function printedTitle(title: EarlierTitle): EarlierTitle {
  const points = Array.from(title.question);
  return points.length > EARLIER_TITLE_MAX_CHARS
    ? { ...title, question: `${points.slice(0, EARLIER_TITLE_MAX_CHARS).join('')}…` }
    : title;
}

function titlesThatFit(id: string, path: string, eligible: EarlierTitle[]): EarlierTitle[] {
  const empty: PendingCreateOutput = {
    id,
    path,
    earlier_check: titleBlock(id, [], eligible.length),
  };
  let used = printDecisionOutput(empty).length;
  const fit: EarlierTitle[] = [];
  for (const title of eligible.slice(0, EARLIER_TITLE_LIMIT)) {
    used += JSON.stringify(printedTitle(title)).length + 1;
    if (used >= EARLIER_OUTPUT_MAX_CHARS) break;
    fit.push(title);
  }
  return fit;
}

export interface TitleCheckQuery extends EarlierTitleQuery {
  excludeId: string;
  path: string;
}

export function titleCheckFor(projectRoot: string, query: TitleCheckQuery): EarlierCheck | null {
  try {
    const eligible = eligibleTitles(projectRoot, query);
    if (eligible.length === 0) return null;
    const fit = titlesThatFit(query.excludeId, query.path, eligible);
    const omitted = eligible.length - fit.length;
    return {
      status: 'required',
      listed_by: 'titles',
      candidates: fit.map((title) => title.id),
      ...(omitted > 0 ? { older_omitted: omitted } : {}),
    };
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
    return text === '' || text.length > EARLIER_METHOD_MAX_CHARS ? EARLIER_METHOD_FALLBACK : text;
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
  recommendation_reason?: string;
  earlier_check?: EarlierCheck;
  suggestion?: DecisionSuggestion;
  change?: string;
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

export interface EarlierTitlesBlock {
  required: true;
  method: string;
  next: string;
  older_omitted?: number;
  missing?: string[];
  titles: EarlierTitle[];
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
  const { found, missing } = readOffered(projectRoot, check.candidates ?? []);
  return {
    required: true,
    candidates: found,
    ...(missing.length > 0 ? { missing } : {}),
    method: readEarlierMethod(),
    next: suggestCommand(id),
  };
}

function readOffered(
  projectRoot: string,
  ids: string[],
): { found: EarlierCandidate[]; missing: string[] } {
  const found: EarlierCandidate[] = [];
  const missing: string[] = [];
  for (const offeredId of ids) {
    const candidate = readCandidate(projectRoot, offeredId);
    if (candidate) found.push(candidate);
    else missing.push(offeredId);
  }
  return { found, missing };
}

function suggestCommand(id: string): string {
  return `paqad-ai decision suggest ${id} --earlier <D-id> --option <key> --reason <text>, or --none --reason <text>`;
}

function titleBlock(
  id: string,
  titles: EarlierTitle[],
  olderOmitted = 0,
  missing: string[] = [],
): EarlierTitlesBlock {
  return {
    required: true,
    method: readEarlierMethod(),
    next: `Read up to ${EARLIER_LIMIT} with paqad-ai decision check ${id} --read <D-id> ... Then ${suggestCommand(id)}`,
    ...(olderOmitted > 0 ? { older_omitted: olderOmitted } : {}),
    ...(missing.length > 0 ? { missing } : {}),
    titles,
  };
}

function checkBlockFor(
  projectRoot: string,
  id: string,
  check: EarlierCheck,
): EarlierCheckBlock | EarlierTitlesBlock {
  if (check.listed_by !== 'titles') return earlierCheckBlock(projectRoot, id, check);
  const { found, missing } = readOffered(projectRoot, check.candidates ?? []);
  const titles = found.map(({ id: earlierId, category, question }) =>
    printedTitle({ id: earlierId, category, question }),
  );
  return titleBlock(id, titles, check.older_omitted, missing);
}

export function printDecisionOutput(output: object): string {
  const check = (output as { earlier_check?: object }).earlier_check;
  return check !== undefined && 'titles' in check
    ? JSON.stringify(output)
    : JSON.stringify(output, null, 2);
}

export const NO_STANDING_ANSWER_CATEGORIES: readonly string[] = [
  ...PRIVATE_ANSWER_CATEGORIES,
  'spec.change',
  'architecture-path',
  'spec.contradiction',
  'analytics.taxonomy_violation',
  'analytics.new_event',
];

export const ALWAYS_LABEL = 'Always use this answer for this kind of question';

export const MAX_ALWAYS_OPTIONS = 3;

export interface QuestionEntry {
  label: string;
  option_key: string;
  resolve: string;
  always?: true;
}

export interface QuestionBlock {
  question: string;
  options: QuestionEntry[];
  not_shown?: QuestionEntry[];
  other?: string;
}

export const MAX_QUESTION_ENTRIES = 4;

function shellArg(value: string): string {
  return /^[\w:.@/=-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

function resolveCommand(id: string, key: string): string {
  return `paqad-ai decision resolve ${id} ${shellArg(key)}`;
}

function plainEntry(id: string, option: { option_key: string; label: string }): QuestionEntry {
  return {
    label: option.label,
    option_key: option.option_key,
    resolve: resolveCommand(id, option.option_key),
  };
}

function suggestedEntries(
  id: string,
  packet: StoredPendingPacket,
  suggestion: DecisionSuggestion,
): QuestionEntry[] | null {
  const suggested = packet.options.find((option) => option.option_key === suggestion.option_key);
  if (suggested === undefined) return null;
  const first: QuestionEntry = {
    ...plainEntry(id, suggested),
    label: `Same as last time: ${suggested.label} (from ${suggestion.earlier_id})`,
  };
  const rest = packet.options
    .filter((option) => option.option_key !== suggestion.option_key)
    .map((option) => plainEntry(id, option));
  const always: QuestionEntry[] = canOfferAlways(packet)
    ? [
        {
          label: ALWAYS_LABEL,
          option_key: suggested.option_key,
          resolve: `${resolveCommand(id, suggested.option_key)} --always`,
          always: true,
        },
      ]
    : [];
  return [first, ...rest, ...always];
}

function canOfferAlways(packet: StoredPendingPacket): boolean {
  return (
    packet.id !== undefined &&
    packet.options.length <= MAX_ALWAYS_OPTIONS &&
    !NO_STANDING_ANSWER_CATEGORIES.includes(packet.category)
  );
}

export function buildQuestionBlock(id: string, packet: StoredPendingPacket): QuestionBlock {
  const entries =
    (packet.suggestion && suggestedEntries(id, packet, packet.suggestion)) ??
    packet.options.map((option) => plainEntry(id, option));
  const question = packet.title ?? packet.question ?? '';
  const options = entries.slice(0, MAX_QUESTION_ENTRIES);
  if (packet.id === undefined) {
    const notShown = entries.slice(MAX_QUESTION_ENTRIES);
    return { question, options, ...(notShown.length > 0 ? { not_shown: notShown } : {}) };
  }
  return {
    question,
    options,
    other: `paqad-ai decision resolve ${id} other --other "<text>"`,
  };
}

export type DecisionCheckOutput =
  | { id: string; earlier_check: EarlierCheckBlock | EarlierTitlesBlock }
  | { id: string; earlier_check: { required: false }; question: QuestionBlock };

function requirePendingFile(projectRoot: string, id: string): StoredPendingPacket {
  const packet = readPendingFile(projectRoot, id);
  if (packet !== null) return packet;
  const resolved =
    isStrictDecisionId(id) &&
    existsSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`));
  throw new Error(
    resolved ? `Decision ${id} is already resolved.` : `Decision ${id} was not found.`,
  );
}

export function checkDecision(projectRoot: string, id: string): DecisionCheckOutput {
  const packet = requirePendingFile(projectRoot, id);
  if (packet.earlier_check?.status === 'required') {
    return { id, earlier_check: checkBlockFor(projectRoot, id, packet.earlier_check) };
  }
  return { id, earlier_check: { required: false }, question: buildQuestionBlock(id, packet) };
}

export interface StandingReuse {
  rule: string;
  chosen: string;
  label: string;
}

export interface PendingDecisionResult {
  id: string;
  path: string;
  reused?: undefined;
}

export interface ReusedDecisionResult {
  id: string;
  path: string;
  reused: StandingReuse;
}

export type DecisionCreateResult = PendingDecisionResult | ReusedDecisionResult;

export interface ReusedCreateOutput {
  reused: true;
  id: string;
  chosen: string;
  label: string;
  match: 'standing';
  say: string;
}

export interface PendingCreateOutput {
  id: string;
  path: string;
  earlier_check?: EarlierCheckBlock | EarlierTitlesBlock;
}

function standingSayLine(label: string, ruleId: string): string {
  return `I used your standing answer: ${label} (rule ${ruleId}), so I did not ask. Say "ask me anyway" to be asked this time (--ask-anyway), or "remove that rule" to stop it (paqad-ai decision standing remove ${ruleId}).`;
}

export function formatCreateOutput(
  projectRoot: string,
  result: DecisionCreateResult,
): PendingCreateOutput | ReusedCreateOutput {
  if (result.reused) {
    return {
      reused: true,
      id: result.id,
      chosen: result.reused.chosen,
      label: result.reused.label,
      match: 'standing',
      say: standingSayLine(result.reused.label, result.reused.rule),
    };
  }
  const check = readPendingFile(projectRoot, result.id)?.earlier_check;
  if (!check) return { id: result.id, path: result.path };
  return {
    id: result.id,
    path: result.path,
    earlier_check: checkBlockFor(projectRoot, result.id, check),
  };
}

export interface SuggestEarlierInput {
  earlier?: string;
  option?: string;
  none?: boolean;
  reason?: string;
}

function writePendingFile(projectRoot: string, id: string, packet: StoredPendingPacket): void {
  const path = pendingFile(projectRoot, id);
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(packet, null, 2)}\n`);
  renameWithRetrySync(tempPath, path);
}

function assertSuggestable(
  projectRoot: string,
  id: string,
  packet: StoredPendingPacket,
  input: SuggestEarlierInput,
): void {
  const check = packet.earlier_check!;
  if (input.none) return;
  const earlier = input.earlier!;
  const offered = check.candidates ?? [];
  if (!offered.includes(earlier)) {
    const list = check.listed_by === 'titles' ? '' : ` Offered: ${offered.join(', ')}.`;
    throw new Error(`${earlier} was not offered for ${id}.${list}`);
  }
  if (readCandidate(projectRoot, earlier) === null) {
    throw new Error(`${earlier} can no longer be read, so it cannot be suggested for ${id}.`);
  }
  if (!packet.options.some((option) => option.option_key === input.option)) {
    const keys = packet.options.map((option) => option.option_key).join(', ');
    throw new Error(`Option "${input.option}" is not one of ${id}'s options (${keys}).`);
  }
}

export function suggestEarlierAnswer(
  projectRoot: string,
  id: string,
  input: SuggestEarlierInput,
): DecisionCheckOutput {
  const reason = input.reason?.trim() ?? '';
  if (Boolean(input.earlier) === Boolean(input.none)) {
    throw new Error('Give exactly one of --earlier <D-id> or --none.');
  }
  if (input.earlier && !input.option) {
    throw new Error('--earlier needs --option <key>.');
  }
  if (reason === '') {
    throw new Error('A suggestion needs a non-empty --reason.');
  }
  const packet = requirePendingFile(projectRoot, id);
  if (packet.earlier_check === undefined) {
    throw new Error(`Decision ${id} has no earlier answers to check.`);
  }
  if (packet.earlier_check.status !== 'required') {
    throw new Error(`Decision ${id} has already been checked.`);
  }
  assertSuggestable(projectRoot, id, packet, input);
  writePendingFile(
    projectRoot,
    id,
    input.none ? withNoneFound(packet, reason) : withSuggestion(packet, input, reason),
  );
  if (input.none) {
    recordDecisionReuse(projectRoot, {
      kind: 'suggestion',
      decisionId: null,
      category: packet.category,
      note: reason,
      outcome: 'none',
      change: packet.change,
      forDecision: id,
    });
  }
  return checkDecision(projectRoot, id);
}

function withNoneFound(packet: StoredPendingPacket, reason: string): StoredPendingPacket {
  return {
    ...packet,
    earlier_check: { ...packet.earlier_check!, status: 'done', none_reason: reason },
  };
}

function withSuggestion(
  packet: StoredPendingPacket,
  input: SuggestEarlierInput,
  reason: string,
): StoredPendingPacket {
  const optionKey = input.option!;
  return {
    ...packet,
    earlier_check: { ...packet.earlier_check!, status: 'done' },
    suggestion: {
      earlier_id: input.earlier!,
      option_key: optionKey,
      reason,
      at: new Date().toISOString(),
    },
    recommendation: optionKey,
    recommendation_reason: reason,
  };
}
