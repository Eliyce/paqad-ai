// What a change cost: `cost.json` in the change's bundle (issue #639, Part 23).
//
// The tokens come from the host's own transcripts: the main session's (its path arrives on every
// hook payload as `transcript_path`) and each paqad subagent's (`agent_transcript_path` on
// SubagentStop). Each message is counted once, by message id, across every transcript. Only the
// change's window counts: from its first `open` row in stage-evidence.jsonl to its seal (the
// receipt's verified time, else the close row, else now).
//
// Who spent what:
//   - a stage agent (`paqad-<stage>`) is charged to its stage;
//   - a High Table seat is charged to its role (the chief to `chief`) and, since the table sits
//     during the spec, to the specification stage;
//   - everything else (the main session, any other paqad agent) is charged to the stage whose
//     recorded start and end hold the message's time, else to `orchestrator`.
//
// The Stop seam must stay fast, so the reads are incremental. A per-session cache under
// `.paqad/session/hud/` keeps, for each transcript, the byte offset read so far and the usage of
// every message kept from it. Each run reads only the bytes appended since. The cache is
// invalidated per transcript when the file shrinks (a rewrite: read again from the start) and
// when an earlier window floor is asked for (read again from the start), so it never disagrees
// with a full read. Money comes from the dated price table in `prices.ts` and is always labelled
// an estimate. Decision D-01M5AM0F03B730SDSAPVC96W38.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { decodeReceiptStatement } from '@/evidence/receipt/envelope.js';
import { stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readFeatureReceipt } from '@/feature-evidence/receipt.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { HUD_COST_CACHE_SUFFIX, hudCostCachePath, writeFileAtomic } from '@/hud/files.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  CHIEF_ROLE,
  foldHighTable,
  readHighTable,
  roleFromSubagentTranscript,
} from '@/spec-pipeline/high-table.js';
import { STAGE_EVIDENCE_STAGES } from '@/stage-evidence/stages.js';
import {
  CHIEF_ARCHITECT_AGENT_NAME,
  isHighTableAgent,
  stageForAgentName,
  stripPluginAgentNamespace,
} from '@/stage-isolation/stage-agents.js';

import {
  COST_BASIS,
  COST_LABEL,
  COST_PLAN_NOTE,
  NOT_COUNTED,
  PRICE_TABLE_DATE,
  PRICE_TABLE_SOURCE,
  messageUsd,
  roundUsd,
} from './prices.js';
import {
  addTokenUsage,
  emptyTokenUsage,
  maxTokenUsage,
  readTranscriptUsage,
  type TokenUsage,
} from './transcript-usage.js';

export const COST_DOC_TYPE = 'paqad.cost';
export const COST_SCHEMA_VERSION = 1;
export const COST_SCHEMA = 'paqad.cost/1';
export const COST_CACHE_SCHEMA = 'paqad.cost-cache/1';

/** The stage a message lands on when no recorded stage holds its time. */
export const ORCHESTRATOR_STAGE = 'orchestrator';
/** The stage a High Table seat is charged to: the table sits while the spec is written. */
export const HIGH_TABLE_STAGE = 'specification';

// ── the cache ─────────────────────────────────────────────────────────────────

/** One kept message: model, time, then input, output, cache read, cache write, 5m, 1h. */
type CachedMessage = [string | null, string | null, number, number, number, number, number, number];

/** One transcript the change cost reads. */
export interface CostSource {
  kind: 'main' | 'agent';
  agent_type: string | null;
  agent_id: string | null;
  /** The stage a stage agent ran, or null. */
  stage: string | null;
  /** The High Table role a seat sat as (`chief-architect` for the chief), or null. */
  role: string | null;
  /** The changes (bundle folder names) this transcript was seen with. */
  changes: string[];
  /** Messages before this time are never kept (the earliest window start asked for). */
  floor: string | null;
  /** The byte offset read so far. */
  offset: number;
  messages: Record<string, CachedMessage>;
}

export interface CostCache {
  schema: typeof COST_CACHE_SCHEMA;
  session_id: string;
  sources: Record<string, CostSource>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function emptyCache(sessionId: string): CostCache {
  return { schema: COST_CACHE_SCHEMA, session_id: sessionId, sources: {} };
}

/** Tolerant read of a cache file: a missing, broken or foreign file reads as empty. */
export function readCostCache(path: string, sessionId: string): CostCache {
  try {
    const raw = asRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (raw?.schema !== COST_CACHE_SCHEMA || !asRecord(raw.sources)) return emptyCache(sessionId);
    return raw as unknown as CostCache;
  } catch {
    return emptyCache(sessionId);
  }
}

/** Every session's cost cache in the project, so a change resumed in a new session adds up. */
function readAllCostCaches(projectRoot: string): CostCache[] {
  const dir = join(projectRoot, PATHS.HUD_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(HUD_COST_CACHE_SUFFIX))
    .map((name) => readCostCache(join(dir, name), name.slice(0, -HUD_COST_CACHE_SUFFIX.length)));
}

// ── recording the transcripts ─────────────────────────────────────────────────

/** The fields of a hook payload the cost reads. */
export interface CostHookPayload {
  session_id?: unknown;
  transcript_path?: unknown;
  agent_id?: unknown;
  agent_type?: unknown;
  agent_transcript_path?: unknown;
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

/** Add `path` to the cache (or tag it with one more change), lowering its floor when asked. */
function registerSource(
  cache: CostCache,
  path: string,
  identity: Pick<CostSource, 'kind' | 'agent_type' | 'agent_id' | 'stage' | 'role'>,
  dirName: string,
  floor: string,
): void {
  const existing = cache.sources[path];
  if (!existing) {
    cache.sources[path] = {
      ...identity,
      changes: [dirName],
      floor,
      offset: 0,
      messages: {},
    };
    return;
  }
  if (!existing.changes.includes(dirName)) existing.changes.push(dirName);
  const lowered = earlier(existing.floor, floor);
  if (lowered !== existing.floor) {
    // An earlier window than the kept messages cover: read the transcript again from the start.
    existing.floor = lowered;
    existing.offset = 0;
    existing.messages = {};
  }
}

/** Who a subagent was: its stage, or its High Table role (read once, from its own transcript). */
function agentIdentity(
  agentType: string,
  agentId: string | null,
  path: string,
): Pick<CostSource, 'kind' | 'agent_type' | 'agent_id' | 'stage' | 'role'> {
  const name = stripPluginAgentNamespace(agentType.trim());
  let role: string | null = null;
  if (isHighTableAgent(agentType)) {
    role = name === CHIEF_ARCHITECT_AGENT_NAME ? CHIEF_ROLE : roleFromSubagentTranscript(path);
  }
  return {
    kind: 'agent',
    agent_type: agentType,
    agent_id: agentId,
    stage: stageForAgentName(name),
    role,
  };
}

/** Record the transcripts a hook payload names, tagged with the change `dirName`. */
export function recordCostSources(
  cache: CostCache,
  payload: CostHookPayload,
  dirName: string,
  floor: string,
): void {
  const main = str(payload.transcript_path);
  if (main) {
    registerSource(
      cache,
      main,
      { kind: 'main', agent_type: null, agent_id: null, stage: null, role: null },
      dirName,
      floor,
    );
  }
  const agentPath = str(payload.agent_transcript_path);
  const agentType = str(payload.agent_type);
  if (agentPath && agentType && agentPath !== main) {
    const known = cache.sources[agentPath];
    const identity = known ?? agentIdentity(agentType, str(payload.agent_id), agentPath);
    registerSource(cache, agentPath, identity, dirName, floor);
  }
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/** Read what was appended to one transcript since its stored offset, into its kept messages. */
function refreshSource(path: string, source: CostSource, chunkBytes?: number): void {
  const size = fileSize(path);
  if (size === null) return; // Gone: keep what was read; a later run may find it again.
  if (size < source.offset) {
    // The file shrank, so it was rewritten: what was read no longer matches it.
    source.offset = 0;
    source.messages = {};
  }
  if (size === source.offset) return;
  const usage = readTranscriptUsage(path, { fromOffset: source.offset, chunkBytes });
  const floor = source.floor === null ? Number.NaN : Date.parse(source.floor);
  for (const message of usage.messages) {
    const at = message.timestamp === null ? Number.NaN : Date.parse(message.timestamp);
    // A message with no readable time can never be placed in a window, so it is not kept.
    if (Number.isNaN(at) || at < floor) continue;
    const kept = source.messages[message.id];
    const merged = kept ? maxTokenUsage(usageOf(kept), message.usage) : message.usage;
    source.messages[message.id] = [
      kept?.[0] ?? message.model,
      kept?.[1] ?? message.timestamp,
      merged.input,
      merged.output,
      merged.cache_read,
      merged.cache_write,
      merged.cache_write_5m,
      merged.cache_write_1h,
    ];
  }
  source.offset = usage.end_offset;
}

function usageOf(message: CachedMessage): TokenUsage {
  const [, , input, output, cacheRead, cacheWrite, write5m, write1h] = message;
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    cache_write_5m: write5m,
    cache_write_1h: write1h,
    total: input + output + cacheRead + cacheWrite,
  };
}

export interface UpdateCostCacheInput {
  projectRoot: string;
  sessionId: string;
  dirName: string;
  payload: CostHookPayload;
  /** The change's window start: messages before it are never kept. */
  floor: string;
  chunkBytes?: number;
}

/**
 * Record the payload's transcripts and read what each of the change's transcripts gained since
 * the last run, then write the session's cache atomically. Throws on a write fault.
 */
export function updateCostCache(input: UpdateCostCacheInput): CostCache {
  const path = hudCostCachePath(input.projectRoot, input.sessionId);
  const cache = readCostCache(path, input.sessionId);
  recordCostSources(cache, input.payload, input.dirName, input.floor);
  for (const [source, entry] of Object.entries(cache.sources)) {
    if (entry.changes.includes(input.dirName)) refreshSource(source, entry, input.chunkBytes);
  }
  writeFileAtomic(path, `${JSON.stringify(cache)}\n`);
  return cache;
}

// ── the window ────────────────────────────────────────────────────────────────

export interface CostWindow {
  from: string;
  to: string;
  /** True when the window ends at a seal (the receipt or the close row), not at now. */
  sealed: boolean;
  sealed_by: 'receipt' | 'close' | null;
}

function receiptTime(projectRoot: string, dirName: string): string | null {
  const envelope = readFeatureReceipt(projectRoot, dirName);
  if (!envelope) return null;
  return str(decodeReceiptStatement(envelope)?.predicate?.time_verified);
}

/** The time of the close row that left the change closed (the last open or close row). */
function closeTime(rows: readonly SessionLedgerRow[]): string | null {
  let closed: string | null = null;
  for (const row of rows) {
    if (row.kind === 'open') closed = null;
    else if (row.kind === 'close') closed = rowRecordedAt(row);
  }
  return closed;
}

/** The change's window, or null when it has no `open` row to start from. */
export function changeCostWindow(
  projectRoot: string,
  dirName: string,
  now: () => Date = () => new Date(),
  rows: readonly SessionLedgerRow[] = readFeatureStageUnit(projectRoot, dirName),
): CostWindow | null {
  const open = rows.find((row) => row.kind === 'open');
  const from = open ? rowRecordedAt(open) : null;
  if (from === null) return null;
  const receipt = receiptTime(projectRoot, dirName);
  if (receipt) return { from, to: receipt, sealed: true, sealed_by: 'receipt' };
  const close = closeTime(rows);
  if (close) return { from, to: close, sealed: true, sealed_by: 'close' };
  return { from, to: now().toISOString(), sealed: false, sealed_by: null };
}

// ── stage windows ─────────────────────────────────────────────────────────────

interface StageSpan {
  stage: string;
  start: number;
  end: number;
}

/** Each recorded start of a stage paired with its next end (an open stage runs to the end). */
function stageSpans(rows: readonly SessionLedgerRow[]): StageSpan[] {
  const spans: StageSpan[] = [];
  rows.forEach((row, index) => {
    const stage = str(row.stage);
    const at = rowRecordedAt(row);
    if (row.kind !== 'stage_start' || stage === null || at === null) return;
    const end = rows
      .slice(index + 1)
      .find((later) => later.kind === 'stage_end' && later.stage === stage);
    const endAt = end ? rowRecordedAt(end) : null;
    spans.push({
      stage,
      start: Date.parse(at),
      end: endAt === null ? Number.POSITIVE_INFINITY : Date.parse(endAt),
    });
  });
  return spans;
}

/** The stage whose span holds `at` (the latest started one wins), else the orchestrator. */
function stageAt(spans: readonly StageSpan[], at: number): string {
  let best: StageSpan | null = null;
  for (const span of spans) {
    if (at < span.start || at > span.end) continue;
    if (best === null || span.start >= best.start) best = span;
  }
  return best?.stage ?? ORCHESTRATOR_STAGE;
}

// ── the record ────────────────────────────────────────────────────────────────

/** Token counts as the record shows them (the 5m and 1h split stays inside the price). */
export interface CostTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
}

export interface CostLine {
  tokens: CostTokens;
  /** The priced part in US dollars, or null when none of it is priced. */
  usd: number | null;
}

export interface CostStageLine extends CostLine {
  stage: string;
}

export interface CostExpertLine extends CostLine {
  role: string;
  /** True when read from the seat's own transcript; false for its own self-reported estimate. */
  exact: boolean;
}

export interface CostModelLine extends CostLine {
  model: string;
}

/** The body of `cost.json`; the bundle envelope header comes first on disk. */
export interface ChangeCostRecord {
  schema: typeof COST_SCHEMA;
  computed_at: string;
  window: CostWindow;
  price_table_date: string;
  price_source: string;
  basis: string;
  label: string;
  plan_note: string;
  tokens: CostTokens;
  /** The priced part in US dollars; null when no token in the window is priced. */
  usd: number | null;
  /** Models seen with tokens but not in the price table: their tokens count, their money does not. */
  unpriced_models: string[];
  by_model: CostModelLine[];
  by_stage: CostStageLine[];
  /** One line per expert seat. Exact lines are part of the total; estimate lines are not. */
  by_expert: CostExpertLine[];
  chief: (CostLine & { exact: boolean }) | null;
  not_counted: string[];
  /** How many transcripts were read. */
  sources: number;
}

interface Bucket {
  usage: TokenUsage;
  usd: number;
  priced: boolean;
}

function emptyBucket(): Bucket {
  return { usage: emptyTokenUsage(), usd: 0, priced: false };
}

function addToBucket(bucket: Bucket, usage: TokenUsage, usd: number | null): void {
  bucket.usage = addTokenUsage(bucket.usage, usage);
  if (usd !== null) {
    bucket.usd += usd;
    bucket.priced = true;
  }
}

function tokensOf(usage: TokenUsage): CostTokens {
  return {
    input: usage.input,
    output: usage.output,
    cache_read: usage.cache_read,
    cache_write: usage.cache_write,
    total: usage.total,
  };
}

function lineOf(bucket: Bucket): CostLine {
  return { tokens: tokensOf(bucket.usage), usd: bucket.priced ? roundUsd(bucket.usd) : null };
}

interface Attributed {
  model: string | null;
  at: number;
  usage: TokenUsage;
  stage: string | null;
  role: string | null;
}

/** Every kept message of the change's transcripts, each once, agents' attribution first. */
function collectMessages(
  caches: readonly CostCache[],
  dirName: string,
): {
  messages: Map<string, Attributed>;
  sources: number;
} {
  const entries = caches.flatMap((cache) =>
    Object.values(cache.sources).filter((source) => source.changes.includes(dirName)),
  );
  // Subagent transcripts first, so a message a host also copied into the main transcript keeps
  // the agent's stage or seat.
  entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'agent' ? -1 : 1));
  const messages = new Map<string, Attributed>();
  for (const source of entries) {
    for (const [id, kept] of Object.entries(source.messages)) {
      const usage = usageOf(kept);
      const existing = messages.get(id);
      if (existing) {
        existing.usage = maxTokenUsage(existing.usage, usage);
        continue;
      }
      messages.set(id, {
        model: kept[0],
        at: kept[1] === null ? Number.NaN : Date.parse(kept[1]),
        usage,
        stage: source.role !== null ? HIGH_TABLE_STAGE : source.stage,
        role: source.role,
      });
    }
  }
  return { messages, sources: entries.length };
}

function orderStages(buckets: Map<string, Bucket>): CostStageLine[] {
  const rank = (stage: string): number => {
    const index = STAGE_EVIDENCE_STAGES.indexOf(stage);
    return index === -1 ? STAGE_EVIDENCE_STAGES.length : index;
  };
  return [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([stage, bucket]) => ({ stage, ...lineOf(bucket) }));
}

/** Seats with no exact usage but a self-reported estimate, as estimate lines (not in the total). */
function estimateLines(
  projectRoot: string,
  dirName: string,
  exactRoles: ReadonlySet<string>,
): CostExpertLine[] {
  const lines: CostExpertLine[] = [];
  for (const seat of foldHighTable(readHighTable(projectRoot, dirName)).values()) {
    if (exactRoles.has(seat.role) || seat.tokens_estimate === null) continue;
    lines.push({
      role: seat.role,
      tokens: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        total: seat.tokens_estimate,
      },
      usd: null,
      exact: false,
    });
  }
  return lines;
}

export interface ComputeChangeCostOptions {
  now?: () => Date;
  /** The caches to read; every session's cache in the project when absent. */
  caches?: readonly CostCache[];
}

/**
 * Sum the change's usage over its window, split by stage, by expert and the chief, and price it.
 * Null when the change has no `open` row. Reads only; never throws on a missing file.
 */
export function computeChangeCost(
  projectRoot: string,
  dirName: string,
  options: ComputeChangeCostOptions = {},
): ChangeCostRecord | null {
  const now = options.now ?? (() => new Date());
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const window = changeCostWindow(projectRoot, dirName, now, rows);
  if (window === null) return null;
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const spans = stageSpans(rows);
  const { messages, sources } = collectMessages(
    options.caches ?? readAllCostCaches(projectRoot),
    dirName,
  );

  const total = emptyBucket();
  const byModel = new Map<string, Bucket>();
  const byStage = new Map<string, Bucket>();
  const byRole = new Map<string, Bucket>();
  const unpriced = new Set<string>();
  for (const message of messages.values()) {
    if (Number.isNaN(message.at) || message.at < from || message.at > to) continue;
    if (message.usage.total === 0) continue;
    const usd = messageUsd(message.usage, message.model);
    const model = message.model ?? 'unknown';
    if (usd === null) unpriced.add(model);
    addToBucket(total, message.usage, usd);
    const modelBucket = byModel.get(model) ?? emptyBucket();
    addToBucket(modelBucket, message.usage, usd);
    byModel.set(model, modelBucket);
    const stage = message.stage ?? stageAt(spans, message.at);
    const stageBucket = byStage.get(stage) ?? emptyBucket();
    addToBucket(stageBucket, message.usage, usd);
    byStage.set(stage, stageBucket);
    if (message.role !== null) {
      const roleBucket = byRole.get(message.role) ?? emptyBucket();
      addToBucket(roleBucket, message.usage, usd);
      byRole.set(message.role, roleBucket);
    }
  }

  const chiefBucket = byRole.get(CHIEF_ROLE);
  const exactExperts: CostExpertLine[] = [...byRole.entries()]
    .filter(([role]) => role !== CHIEF_ROLE)
    .map(([role, bucket]) => ({ role, ...lineOf(bucket), exact: true }));
  const estimated = estimateLines(projectRoot, dirName, new Set(byRole.keys()));
  const chiefEstimate = estimated.find((line) => line.role === CHIEF_ROLE);

  return {
    schema: COST_SCHEMA,
    computed_at: now().toISOString(),
    window,
    price_table_date: PRICE_TABLE_DATE,
    price_source: PRICE_TABLE_SOURCE,
    basis: COST_BASIS,
    label: COST_LABEL,
    plan_note: COST_PLAN_NOTE,
    tokens: tokensOf(total.usage),
    usd: total.priced ? roundUsd(total.usd) : null,
    unpriced_models: [...unpriced].sort(),
    by_model: [...byModel.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, bucket]) => ({ model, ...lineOf(bucket) })),
    by_stage: orderStages(byStage),
    by_expert: [...exactExperts, ...estimated.filter((line) => line.role !== CHIEF_ROLE)],
    chief: chiefBucket
      ? { ...lineOf(chiefBucket), exact: true }
      : chiefEstimate
        ? { tokens: chiefEstimate.tokens, usd: null, exact: false }
        : null,
    not_counted: [...NOT_COUNTED],
    sources,
  };
}

/** Write the record into the change's bundle as `cost.json`, atomically. Throws on a fault. */
export function writeChangeCost(
  projectRoot: string,
  dirName: string,
  record: ChangeCostRecord,
  sessionId?: string | null,
): string {
  const document = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: COST_DOC_TYPE,
    schemaVersion: COST_SCHEMA_VERSION,
    sessionId,
    body: record as unknown as Record<string, unknown>,
  });
  const path = join(projectRoot, featureFilePath(dirName, 'cost'));
  writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
}

/** Tolerant read of a change's `cost.json` body, or null when absent, broken or foreign. */
export function readChangeCost(projectRoot: string, dirName: string): ChangeCostRecord | null {
  try {
    const raw = asRecord(
      JSON.parse(readFileSync(join(projectRoot, featureFilePath(dirName, 'cost')), 'utf8')),
    );
    return raw?.schema === COST_SCHEMA ? (raw as unknown as ChangeCostRecord) : null;
  } catch {
    return null;
  }
}
