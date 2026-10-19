// The High Table ledger: `high-table.jsonl` in the change's bundle (issue #639, Part 13).
//
// The spec pipeline's experts sit at "the High Table", chaired by the chief architect. Each
// expert runs as its own host subagent (`paqad-expert`, its role given in the prompt) and the
// chief runs as `paqad-chief-architect`, so several seats write at once. `experts.json` is a
// document rewritten whole, so it cannot say when a seat started or finished; this append-only
// ledger does. One JSON line per event, each stamped with the bundle envelope (`recorded_at` and
// `session_id` included):
//
//   - `seated`  one per seat at `experts record`: role, reason, origin, the budget granted after
//               the token ceiling and whether the ceiling clamped it; plus the chief's seat with
//               its fixed 10000-token budget.
//   - `writing` when a seat starts: `experts brief <role>` for an expert, `experts context` for
//               the chief (once the notes are in).
//   - `done`    when a seat's work lands: `experts notes` for each role in the artifact,
//               `experts synthesis` for the chief. It carries the self-reported tokens,
//               labelled an estimate.
//   - `usage`   written by the existing SubagentStop hook for a High Table agent: the exact
//               tokens by kind and model, read from that subagent's own transcript. With no
//               readable subagent transcript no `usage` row is written, so the seat keeps its
//               self-reported estimate (AC-41).
//
// Nothing here edits `experts.json`; the HUD folds both into the live table.

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
import { resolveSessionId } from '@/rag-ledger/session.js';
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

/** The chief architect's seat name on the ledger. */
export const CHIEF_ROLE: AgentRole = 'chief-architect';
/** The chief architect's fixed budget, from the one canonical budget table. */
export const CHIEF_BUDGET_TOKENS = ROLE_TOKEN_BUDGETS[CHIEF_ROLE];

export type HighTableEvent = 'seated' | 'writing' | 'done' | 'usage';

/** One seat as `experts record` seats it. */
export interface SeatInput {
  role: AgentRole;
  reason: string | null;
  origin: string | null;
  budget_tokens: number;
  clamped: boolean;
}

export interface HighTableWriteOptions {
  /** The session the row is recorded under; the ledger's resolved session when absent. */
  sessionId?: string | null;
  now?: () => Date;
}

/** Append one row to the change's `high-table.jsonl`. Throws on a write fault (callers decide). */
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

/** Tolerant read of the change's High Table rows, oldest first. */
export function readHighTable(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'highTable'));
}

/** `seated` rows for every expert seat, then the chief's seat (`experts record`). */
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

/** A `writing` row: an expert printed its brief, or the chief read the notes. */
export function recordWritingRow(
  projectRoot: string,
  dirName: string,
  role: string,
  options: HighTableWriteOptions,
): void {
  appendHighTableRow(projectRoot, dirName, { event: 'writing', role }, options);
}

/** What a `done` row carries: the seat's finding count and its self-reported tokens. */
export interface DoneInput {
  role: string;
  findings: number | null;
  tokens_estimate: number | null;
}

/** A `done` row, its tokens labelled an estimate (the seat reported them itself). */
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

// ── Exact tokens from SubagentStop ─────────────────────────────────────────────────────

const BRIEF_COMMAND = /\bexperts\s+brief\s+([a-z][a-z0-9-]*)/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The shell commands an assistant transcript event ran through a tool, if any. */
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

/**
 * The expert role a `paqad-expert` subagent sat as: the role named by the first
 * `paqad-ai spec pipeline experts brief <role>` command it ran. Null when it ran none, the
 * transcript is unreadable, or the name is not an expert role.
 */
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
    // Unreadable: no role, so no usage row (the seat keeps its estimate).
    return null;
  }
  return role !== null && isExpertRole(role) ? role : null;
}

/** The fields of a host SubagentStop payload the usage recorder reads. */
export interface HighTableStopPayload {
  agent_id?: unknown;
  agent_type?: unknown;
  agent_transcript_path?: unknown;
}

export interface RecordHighTableUsageInput {
  projectRoot: string;
  payload: HighTableStopPayload;
  now?: () => Date;
}

/** What the recorder did, so the hook and the tests can tell the cases apart. */
export type HighTableUsageOutcome =
  'recorded' | 'not-high-table' | 'no-transcript' | 'no-usage' | 'no-role' | 'no-feature';

/**
 * Record a finished High Table seat's exact tokens as one `usage` row (issue #639, Part 13). Read
 * only from the subagent's own transcript (`agent_transcript_path`), never the parent's. With no
 * readable subagent transcript, no usage in it, no recognisable role or no active change, nothing
 * is written and the seat keeps its self-reported estimate. Never writes a `stage-agent` row. A
 * write fault throws, so the hook that calls it can log it without changing its own result.
 */
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
  // Key on the orchestrator's ledger session (as the stage-agent recorder does), so every row of
  // the change shares one identity even though the seat ran in its own context.
  const sessionId = resolveSessionId(input.projectRoot, null);
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

// ── Fold: one seat's live state ────────────────────────────────────────────────────────

/** One seat folded from its rows. */
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
  /** Exact tokens summed over the seat's `usage` rows (one per subagent run), or null. */
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

/** Apply one row to its seat. A new `seated` row (a redo of `experts record`) starts it over. */
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

/**
 * Fold the ledger into one seat per role, in the order each role first appears. Usage rows are
 * de-duplicated by `agent_id` (a hook that fired twice for one subagent counts once).
 */
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

/** Every `done` time on the ledger, oldest first (for the after-freeze check). */
export function highTableDoneTimes(rows: readonly SessionLedgerRow[]): string[] {
  return rows
    .filter((row) => row.event === 'done')
    .map((row) => str(row.recorded_at) ?? str(row.ts))
    .filter((at): at is string => at !== null);
}
