import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { recordDecisionReuse, recordSuggestionOutcome } from '@/decision-reuse/index.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { ulid } from '@/core/ids/ulid.js';
import {
  isStrictDecisionId,
  type DecisionOptionEvidence,
  type DecisionSuggestion,
  type EarlierCheck,
} from '@/planning/decision-packet.js';
import { appendDecisionAuditEvent } from '@/planning/decision-audit.js';
import { DecisionStore } from '@/planning/decision-store.js';

import {
  assertEarlierCheckDone,
  earlierCheckFor,
  NO_STANDING_ANSWER_CATEGORIES,
  titleCheckFor,
  type DecisionCreateResult,
} from './earlier-answers.js';
import { readAnyDecisionPacket, richFieldsFor, STANDING_ANSWER_RESPONDER } from './packet-shape.js';
import {
  addStandingAnswer,
  assertNotStageAgent,
  findStandingAnswer,
  isStandingFileReadable,
  STANDING_FILE_UNREADABLE,
  type StandingAnswer,
} from './standing-answers.js';

export type ContractDecisionOrigin = 'evidence-armed' | 'expert-conflict' | 'fix-proof';

export interface ContractDecisionOption {
  option_key: string;
  label: string;
  one_line_preview?: string;
  trade_off?: string;
  evidence?: DecisionOptionEvidence;
}

export interface PendingContractDecision {
  id: string;
  category: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation: string | null;
  created_at: string;
  status: 'pending';
  origin?: ContractDecisionOrigin;
  change?: string;
  earlier_check?: EarlierCheck;
  suggestion?: DecisionSuggestion;
}

export interface ResolvedContractDecision extends Omit<PendingContractDecision, 'status'> {
  status: 'resolved';
  chosen: string;
  rationale: string;
  resolved_at: string;
  responded_by?: string;
}

export interface CreateDecisionInput {
  category: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation?: string | null;
  origin?: ContractDecisionOrigin;
  change?: string | null;
  askAnyway?: boolean;
  agentWorded?: boolean;
}

export function mintDecisionId(): string {
  return `D-${ulid()}`;
}

export function isContractDecisionId(id: string): boolean {
  return isStrictDecisionId(id);
}

export function assertContractDecisionId(id: string): void {
  if (!isContractDecisionId(id)) {
    throw new Error(
      `Decision id "${id}" must be the collision-free D-<ULID> form. ` +
        `Mint one with mintDecisionId() (never hand-write a sequential D-{N}).`,
    );
  }
}

function validateCreateInput(input: CreateDecisionInput): string[] {
  const errors: string[] = [];
  if (input.category.trim().length === 0) {
    errors.push('category is required');
  }
  if (input.title.trim().length === 0) {
    errors.push('title is required');
  }
  if (input.context.trim().length === 0) {
    errors.push('context is required');
  }
  if (!Array.isArray(input.options) || input.options.length < 2) {
    errors.push('at least 2 options are required');
  } else {
    const seen = new Set<string>();
    for (const [index, option] of input.options.entries()) {
      if (typeof option?.option_key !== 'string' || option.option_key.trim().length === 0) {
        errors.push(`options[${index}].option_key is required`);
        continue;
      }
      if (typeof option.label !== 'string' || option.label.trim().length === 0) {
        errors.push(`options[${index}].label is required`);
      }
      if (seen.has(option.option_key)) {
        errors.push(`options[${index}].option_key "${option.option_key}" is duplicated`);
      }
      seen.add(option.option_key);
    }
  }
  if (
    input.recommendation !== undefined &&
    input.recommendation !== null &&
    !input.options?.some((option) => option.option_key === input.recommendation)
  ) {
    errors.push('recommendation must reference an option_key');
  }
  return errors;
}

export function createPendingDecision(
  projectRoot: string,
  input: CreateDecisionInput,
): DecisionCreateResult {
  const errors = validateCreateInput(input);
  if (errors.length > 0) {
    throw new Error(`Cannot create decision packet: ${errors.join('; ')}`);
  }

  const id = mintDecisionId();
  const packet: PendingContractDecision = {
    id,
    category: input.category,
    title: input.title,
    context: input.context,
    options: input.options.map(contractOption),
    recommendation: input.recommendation ?? null,
    created_at: new Date().toISOString(),
    status: 'pending',
    ...(input.origin !== undefined ? { origin: input.origin } : {}),
    ...(input.change ? { change: input.change } : {}),
  };

  const rule = input.askAnyway
    ? null
    : findStandingAnswer(projectRoot, {
        category: packet.category,
        question: packet.title,
        optionKeys: packet.options.map((option) => option.option_key),
      });
  if (rule !== null) return answerFromStandingRule(projectRoot, packet, rule);

  const path = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  const check = earlierCheckOnOpen(projectRoot, packet, path, input.agentWorded === true);
  if (check !== null) packet.earlier_check = check;

  atomicWriteJson(path, withRichFields(packet));
  return { id, path };
}

function earlierCheckOnOpen(
  projectRoot: string,
  packet: PendingContractDecision,
  path: string,
  agentWorded: boolean,
): EarlierCheck | null {
  if (richFieldsFor(packet) === null) return null;
  const { id: excludeId, category } = packet;
  return agentWorded
    ? titleCheckFor(projectRoot, { excludeId, category, path })
    : earlierCheckFor(projectRoot, { question: packet.title, excludeId, category });
}

function answerFromStandingRule(
  projectRoot: string,
  packet: PendingContractDecision,
  rule: StandingAnswer,
): DecisionCreateResult {
  const resolved: ResolvedContractDecision = {
    ...packet,
    status: 'resolved',
    chosen: rule.chosen,
    rationale: `Standing answer ${rule.id}`,
    resolved_at: new Date().toISOString(),
    responded_by: STANDING_ANSWER_RESPONDER,
  };
  const path = packetPath(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, packet.id);
  const file = withRichFields(resolved);
  atomicWriteJson(path, file);
  const written = readAnyDecisionPacket(file);
  if (written !== null) {
    appendDecisionAuditEvent(projectRoot, {
      event: 'decision-resolved-by-rule',
      decision_id: written.decision_id,
      fingerprint: written.fingerprint,
      task_session_id: written.task_session_id,
      provider: STANDING_ANSWER_RESPONDER,
      timestamp: resolved.resolved_at,
      category: written.category,
      responded_by: STANDING_ANSWER_RESPONDER,
      chosen_option_key: rule.chosen,
      intent: written.human_response?.intent,
    });
  }
  recordDecisionReuse(projectRoot, {
    kind: 'reuse',
    decisionId: rule.from_decision,
    matchKind: 'standing',
    category: packet.category,
    chosenOptionKey: rule.chosen,
    sourcePath: packetPathRelative(packet.id),
    note: `Standing answer ${rule.id} answered ${packet.id}`,
    change: packet.change,
    forDecision: packet.id,
    ruleId: rule.id,
  });
  const label = packet.options.find((option) => option.option_key === rule.chosen)!.label;
  return { id: packet.id, path, reused: { rule: rule.id, chosen: rule.chosen, label } };
}

export function assertAlwaysAllowed(projectRoot: string, id: string, other?: string): void {
  assertNotStageAgent('set a standing answer');
  if (other) {
    throw new Error('--always cannot be used with --other: a write-in could never match again.');
  }
  const pendingPath = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  if (!existsSync(pendingPath)) return;
  const stored = JSON.parse(readFileSync(pendingPath, 'utf8')) as StoredPacket;
  if (stored.id === undefined) {
    throw new Error(
      `--always is refused for ${id}: rules do not apply to packets opened this way.`,
    );
  }
  if (richFieldsFor(stored as PendingContractDecision) === null) {
    throw new Error(`--always is refused for ${id}: this question has no stable fingerprint.`);
  }
  if (NO_STANDING_ANSWER_CATEGORIES.includes(stored.category ?? '')) {
    throw new Error(`--always is refused for the category ${stored.category}.`);
  }
  if (!isStandingFileReadable(projectRoot)) {
    throw new Error(STANDING_FILE_UNREADABLE);
  }
}

export interface AnswerDecisionOptions {
  change?: string | null;
  always?: boolean;
}

export function answerPendingDecision(
  projectRoot: string,
  id: string,
  chosen: string,
  rationale = '',
  options: AnswerDecisionOptions = {},
): { path: string; packet: ResolvedContractDecision; rule?: StandingAnswer } {
  if (options.always) assertAlwaysAllowed(projectRoot, id);
  const result = resolvePendingDecision(projectRoot, id, chosen, rationale, options);
  if (!options.always) return result;
  const rule = addStandingAnswer(projectRoot, {
    category: result.packet.category,
    question: result.packet.title,
    optionKeys: result.packet.options.map((option) => option.option_key),
    chosen,
    fromDecision: id,
  });
  return { ...result, rule };
}

export function resolvePendingDecision(
  projectRoot: string,
  id: string,
  chosen: string,
  rationale = '',
  options: { change?: string | null } = {},
): { path: string; packet: ResolvedContractDecision } {
  assertContractDecisionId(id);
  const pendingPath = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  if (!existsSync(pendingPath)) {
    throw new Error(`Pending decision ${id} not found at ${pendingPath}.`);
  }
  assertEarlierCheckDone(projectRoot, id);

  const stored = JSON.parse(readFileSync(pendingPath, 'utf8')) as StoredPacket;
  if (stored.id === undefined && stored.decision_id !== undefined) {
    return resolveStorePacket(projectRoot, id, stored, chosen, rationale);
  }
  const pending = stored as PendingContractDecision;
  if (!pending.options?.some((option) => option.option_key === chosen)) {
    const keys = pending.options?.map((option) => option.option_key).join(', ') ?? '';
    throw new Error(`Chosen option "${chosen}" is not one of the packet's options (${keys}).`);
  }

  const resolved: ResolvedContractDecision = {
    ...pending,
    ...(pending.change === undefined && options.change ? { change: options.change } : {}),
    status: 'resolved',
    chosen,
    rationale,
    resolved_at: new Date().toISOString(),
  };

  const resolvedPath = packetPath(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, id);
  atomicWriteJson(resolvedPath, withRichFields(resolved));
  unlinkSync(pendingPath);
  recordSuggestionOutcome(projectRoot, {
    forDecision: id,
    category: resolved.category,
    chosen,
    change: resolved.change,
    suggestion: resolved.suggestion,
  });
  return { path: resolvedPath, packet: resolved };
}

type StoredPacket = Partial<PendingContractDecision> & { decision_id?: string; question?: string };

function resolveStorePacket(
  projectRoot: string,
  id: string,
  stored: StoredPacket,
  chosen: string,
  rationale: string,
): { path: string; packet: ResolvedContractDecision } {
  if (!stored.options?.some((option) => option.option_key === chosen)) {
    const keys = stored.options?.map((option) => option.option_key).join(', ') ?? '';
    throw new Error(`Chosen option "${chosen}" is not one of the packet's options (${keys}).`);
  }
  const resolvedAt = new Date().toISOString();
  const path = new DecisionStore(projectRoot).resolve({
    decisionId: id,
    humanResponse: {
      chosen_option_key: chosen,
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: resolvedAt,
      responded_by: 'paqad-decision-cli',
      carry_over_scope: 'session',
      ...(rationale ? { note: rationale } : {}),
    },
  });
  recordSuggestionOutcome(projectRoot, {
    forDecision: id,
    category: stored.category,
    chosen,
    suggestion: stored.suggestion,
  });
  return {
    path,
    packet: {
      id,
      category: stored.category ?? '',
      title: stored.question ?? '',
      context: stored.context ?? '',
      options: stored.options,
      recommendation: stored.recommendation ?? null,
      created_at: stored.created_at ?? resolvedAt,
      status: 'resolved',
      chosen,
      rationale,
      resolved_at: resolvedAt,
    },
  };
}

function withRichFields(packet: PendingContractDecision | ResolvedContractDecision): object {
  const contractOnly = { ...packet, options: packet.options.map(contractOption) };
  for (const key of RICH_ONLY_KEYS) delete (contractOnly as Record<string, unknown>)[key];
  const rich = richFieldsFor(contractOnly);
  if (rich === null) return contractOnly;
  return {
    ...contractOnly,
    ...rich,
    ...(packet.suggestion ? { recommendation_reason: packet.suggestion.reason } : {}),
  };
}

const RICH_ONLY_KEYS = [
  'decision_id',
  'fingerprint',
  'question',
  'recommendation_reason',
  'confidence',
  'requested_by',
  'task_session_id',
  'ttl_until',
  'invalidation_watch',
  'human_response',
] as const;

function contractOption(option: ContractDecisionOption): ContractDecisionOption {
  return {
    option_key: option.option_key,
    label: option.label,
    ...(option.one_line_preview ? { one_line_preview: option.one_line_preview } : {}),
    ...(option.trade_off ? { trade_off: option.trade_off } : {}),
    ...(option.evidence !== undefined ? { evidence: option.evidence } : {}),
  };
}

export interface ContractDecisionListEntry {
  id: string;
  category: string;
  title: string;
  status: 'pending' | 'resolved';
}

export interface StoredContractDecision {
  packet: PendingContractDecision;
  status: 'pending' | 'resolved';
}

export function readContractDecisions(projectRoot: string): StoredContractDecision[] {
  const rows: StoredContractDecision[] = [];
  const sources = [
    [PATHS.DECISIONS_PENDING_DIR, 'pending'],
    [PATHS.DECISIONS_RESOLVED_DIR, 'resolved'],
  ] as const;
  for (const [relativeDir, status] of sources) {
    const abs = join(projectRoot, relativeDir);
    let files: string[];
    try {
      files = readdirSync(abs);
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      try {
        const packet = JSON.parse(readFileSync(join(abs, file), 'utf8')) as PendingContractDecision;
        rows.push({ packet, status });
      } catch {}
    }
  }
  return rows;
}

export function listContractDecisions(projectRoot: string): ContractDecisionListEntry[] {
  return readContractDecisions(projectRoot).map(({ packet, status }) => ({
    id: packet.id,
    category: packet.category,
    title: packet.title,
    status,
  }));
}

export const WRITE_IN_REFUSED_ON_STORE_SHAPE =
  "This question takes only its listed options, so --other can't be used. Pick one of them.";

export function addWriteInOption(projectRoot: string, id: string, label: string): string {
  assertContractDecisionId(id);
  if (label.trim().length === 0) {
    throw new Error('A write-in option needs a non-empty label.');
  }
  const pendingPath = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  if (!existsSync(pendingPath)) {
    throw new Error(`Pending decision ${id} not found at ${pendingPath}.`);
  }
  const stored = JSON.parse(readFileSync(pendingPath, 'utf8')) as StoredPacket;
  if (stored.id === undefined && stored.decision_id !== undefined) {
    throw new Error(WRITE_IN_REFUSED_ON_STORE_SHAPE);
  }
  const pending = stored as PendingContractDecision;
  const existing = new Set(pending.options.map((option) => option.option_key));
  let key = 'other';
  let suffix = 2;
  while (existing.has(key)) {
    key = `other-${suffix++}`;
  }
  pending.options = [...pending.options, { option_key: key, label }];
  atomicWriteJson(pendingPath, withRichFields(pending));
  return key;
}

function packetPathRelative(id: string): string {
  return join(PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`);
}

function packetPath(projectRoot: string, relativeDir: string, id: string): string {
  return join(projectRoot, relativeDir, `${id}.json`);
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameWithRetrySync(tempPath, path);
}
