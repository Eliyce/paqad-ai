import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import type { AgentRole } from '@/core/types/agent.js';
import {
  readTranscriptUsage,
  scanTranscriptLines,
  type TokenUsage,
} from '@/cost/transcript-usage.js';
import { stampBundleRow } from '@/feature-evidence/envelope.js';
import { featureChangeKey, featureFilePath } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession, resolveSessionId } from '@/rag-ledger/session.js';
import {
  appendStampedRowToUnit,
  readUnitFile,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import {
  CHIEF_ARCHITECT_AGENT_NAME,
  isHighTableAgent,
  stripPluginAgentNamespace,
} from '@/stage-isolation/stage-agents.js';

import { isExpertRole } from './experts/roster.js';

export const HIGH_TABLE_DOC_TYPE = 'paqad.high-table';
export const HIGH_TABLE_SCHEMA_VERSION = 1;

export const CHIEF_ROLE: AgentRole = 'chief-architect';
export const CHIEF_BUDGET_TOKENS = ROLE_TOKEN_BUDGETS[CHIEF_ROLE];

export type HighTableEvent = 'seated' | 'writing' | 'done' | 'usage';

export interface SeatInput {
  role: AgentRole;
  reason: string | null;
  origin: string | null;
  budget_tokens: number;
  clamped: boolean;
}

export interface HighTableWriteOptions {
  sessionId?: string | null;
  now?: () => Date;
}

export function appendHighTableRow(
  projectRoot: string,
  dirName: string,
  row: { event: HighTableEvent; role: string } & Record<string, unknown>,
  options: HighTableWriteOptions,
): SessionLedgerRow {
  const stamped = stampBundleRow({
    docType: HIGH_TABLE_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: options.sessionId ?? resolveSessionId(projectRoot, null),
    schemaVersion: HIGH_TABLE_SCHEMA_VERSION,
    row,
    now: options.now,
  }) as unknown as SessionLedgerRow;
  appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'highTable'), stamped);
  return stamped;
}

export function readHighTable(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'highTable'));
}

export function recordSeatedRows(
  projectRoot: string,
  dirName: string,
  seats: readonly SeatInput[],
  options: HighTableWriteOptions,
): void {
  if (seats.length === 0) return;
  for (const seat of seats) {
    appendHighTableRow(projectRoot, dirName, { event: 'seated', ...seat }, options);
  }
  appendHighTableRow(
    projectRoot,
    dirName,
    {
      event: 'seated',
      role: CHIEF_ROLE,
      reason: null,
      origin: null,
      budget_tokens: CHIEF_BUDGET_TOKENS,
      clamped: false,
    },
    options,
  );
}

export function recordWritingRow(
  projectRoot: string,
  dirName: string,
  role: string,
  options: HighTableWriteOptions,
): void {
  appendHighTableRow(projectRoot, dirName, { event: 'writing', role }, options);
}

export interface DoneInput {
  role: string;
  findings: number | null;
  tokens_estimate: number | null;
}

export function recordDoneRow(
  projectRoot: string,
  dirName: string,
  done: DoneInput,
  options: HighTableWriteOptions,
): void {
  appendHighTableRow(
    projectRoot,
    dirName,
    { event: 'done', ...done, tokens_label: 'estimate' },
    options,
  );
}

const BRIEF_COMMAND = /\bexperts\s+brief\s+([a-z][a-z0-9-]*)/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolCommands(event: unknown): string[] {
  const message = asRecord(asRecord(event)?.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  const commands: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    const command = asRecord(record?.input)?.command;
    if (record?.type === 'tool_use' && typeof command === 'string') commands.push(command);
  }
  return commands;
}

export function roleFromSubagentTranscript(path: string): AgentRole | null {
  let role: string | null = null;
  try {
    scanTranscriptLines(path, (event) => {
      if (role !== null) return;
      for (const command of toolCommands(event)) {
        const match = BRIEF_COMMAND.exec(command);
        if (match) {
          role = match[1]!;
          return;
        }
      }
    });
  } catch {
    return null;
  }
  return role !== null && isExpertRole(role) ? role : null;
}

export interface HighTableStopPayload {
  agent_id?: unknown;
  agent_type?: unknown;
  agent_transcript_path?: unknown;
  session_id?: unknown;
}

export interface RecordHighTableUsageInput {
  projectRoot: string;
  payload: HighTableStopPayload;
  now?: () => Date;
}

export type HighTableUsageOutcome =
  'recorded' | 'not-high-table' | 'no-transcript' | 'no-usage' | 'no-role' | 'no-feature';

export function recordHighTableUsage(input: RecordHighTableUsageInput): HighTableUsageOutcome {
  const agentType = typeof input.payload.agent_type === 'string' ? input.payload.agent_type : null;
  if (agentType === null || !isHighTableAgent(agentType)) return 'not-high-table';
  const path = input.payload.agent_transcript_path;
  if (typeof path !== 'string' || path.trim() === '') return 'no-transcript';
  const usage = readTranscriptUsage(path);
  if (usage.messages.length === 0) return 'no-usage';
  const isChief = stripPluginAgentNamespace(agentType.trim()) === CHIEF_ARCHITECT_AGENT_NAME;
  const role = isChief ? CHIEF_ROLE : roleFromSubagentTranscript(path);
  if (role === null) return 'no-role';
  const sessionId = resolveHookSession(input.projectRoot, input.payload);
  const dirName = currentFeature(input.projectRoot, sessionId);
  if (!dirName) return 'no-feature';
  appendHighTableRow(
    input.projectRoot,
    dirName,
    {
      event: 'usage',
      role,
      agent_id: typeof input.payload.agent_id === 'string' ? input.payload.agent_id : null,
      agent_type: agentType,
      tokens: usage.totals,
      by_model: usage.by_model,
      messages: usage.messages.length,
      tokens_label: 'exact',
    },
    { sessionId, now: input.now },
  );
  return 'recorded';
}

export interface FoldedSeat {
  role: string;
  reason: string | null;
  origin: string | null;
  state: 'seated' | 'writing' | 'done' | null;
  seated_at: string | null;
  started_at: string | null;
  done_at: string | null;
  budget_tokens: number | null;
  clamped: boolean | null;
  findings: number | null;
  tokens_estimate: number | null;
  tokens: TokenUsage | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tokenUsageOf(value: unknown): TokenUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  const field = (key: string): number => num(record[key]) ?? 0;
  return {
    input: field('input'),
    output: field('output'),
    cache_read: field('cache_read'),
    cache_write: field('cache_write'),
    cache_write_5m: field('cache_write_5m'),
    cache_write_1h: field('cache_write_1h'),
    total: field('total'),
  };
}

function sumUsage(a: TokenUsage | null, b: TokenUsage): TokenUsage {
  if (a === null) return b;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    cache_write_5m: a.cache_write_5m + b.cache_write_5m,
    cache_write_1h: a.cache_write_1h + b.cache_write_1h,
    total: a.total + b.total,
  };
}

function emptySeat(role: string): FoldedSeat {
  return {
    role,
    reason: null,
    origin: null,
    state: null,
    seated_at: null,
    started_at: null,
    done_at: null,
    budget_tokens: null,
    clamped: null,
    findings: null,
    tokens_estimate: null,
    tokens: null,
  };
}

function applyRow(seat: FoldedSeat, row: SessionLedgerRow, at: string | null): FoldedSeat {
  switch (row.event) {
    case 'seated':
      return {
        ...emptySeat(seat.role),
        reason: str(row.reason),
        origin: str(row.origin),
        state: 'seated',
        seated_at: at,
        budget_tokens: num(row.budget_tokens),
        clamped: typeof row.clamped === 'boolean' ? row.clamped : null,
      };
    case 'writing':
      return { ...seat, state: 'writing', started_at: at, done_at: null };
    case 'done':
      return {
        ...seat,
        state: 'done',
        done_at: at,
        findings: num(row.findings),
        tokens_estimate: num(row.tokens_estimate),
      };
    case 'usage': {
      const tokens = tokenUsageOf(row.tokens);
      return tokens === null ? seat : { ...seat, tokens: sumUsage(seat.tokens, tokens) };
    }
    default:
      return seat;
  }
}

export function foldHighTable(rows: readonly SessionLedgerRow[]): Map<string, FoldedSeat> {
  const seats = new Map<string, FoldedSeat>();
  const usageAgents = new Set<string>();
  for (const row of rows) {
    const role = str(row.role);
    if (role === null) continue;
    if (row.event === 'usage') {
      const agent = str(row.agent_id);
      if (agent !== null && usageAgents.has(agent)) continue;
      if (agent !== null) usageAgents.add(agent);
    }
    const at = str(row.recorded_at) ?? str(row.ts);
    seats.set(role, applyRow(seats.get(role) ?? emptySeat(role), row, at));
  }
  return seats;
}

export function highTableDoneTimes(rows: readonly SessionLedgerRow[]): string[] {
  return rows
    .filter((row) => row.event === 'done')
    .map((row) => str(row.recorded_at) ?? str(row.ts))
    .filter((at): at is string => at !== null);
}
