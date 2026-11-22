import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { ulid } from '@/core/ids/ulid.js';
import { readContractDecisions } from '@/decisions/authoring.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { featureChangeKey, featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import type { PlanRecord } from '@/feature-evidence/types.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  LINT_CLEANUP_ID,
  ownsFile,
  seamJoiningEntry,
  sliceModel,
  sliceOutOfAttempts,
  type JoiningEntry,
  type Workstream,
  type WorkstreamRisk,
} from '@/planning/slicing.js';

import {
  SLICE_DONE_KIND,
  SLICE_EDIT_ALLOWED_KIND,
  SLICE_END_REFUSED_KIND,
  SLICE_GATE_KIND,
  SLICE_START_KIND,
} from './types.js';

export const DEAD_SLICE_MS = 60 * 60 * 1000;

const AGENT_STOP_KINDS: ReadonlySet<string> = new Set(['stage-agent', 'stage-handback']);

export interface CompiledSlicing {
  workstreams: Workstream[];
  waves: string[][];
  joining: JoiningEntry[];
}

export function readCompiledSlicing(projectRoot: string, dirName: string): CompiledSlicing | null {
  const path = join(projectRoot, featureFilePath(dirName, 'plan'));
  if (!existsSync(path)) return null;
  try {
    const plan = JSON.parse(readFileSync(path, 'utf8')) as Partial<PlanRecord>;
    if (!Array.isArray(plan.workstreams) || plan.workstreams.length === 0) return null;
    return {
      workstreams: plan.workstreams,
      waves: plan.waves ?? [],
      joining: plan.joining ?? [],
    };
  } catch {
    return null;
  }
}

export function sliceIds(slicing: CompiledSlicing): string[] {
  return [...slicing.workstreams.map((w) => w.id), ...slicing.joining.map((j) => j.id)];
}

export function sliceOwnedFiles(slicing: CompiledSlicing, id: string): string[] | null {
  const ws = slicing.workstreams.find((w) => w.id === id);
  if (ws) return ws.owned_files;
  const join = slicing.joining.find((j) => j.id === id);
  return join ? join.owned_files : null;
}

export function sliceRisk(slicing: CompiledSlicing, id: string): WorkstreamRisk {
  return slicing.workstreams.find((w) => w.id === id)?.risk ?? 'high';
}

export interface SliceState {
  id: string;
  agent_id: string | null;
  started_at: string | null;
  last_started_at: string | null;
  done_at: string | null;
  gate_failures: number;
  last_gate_passed: boolean | null;
  last_gate_digest: string | null;
  last_gate_failures: string[];
  done: boolean;
  stopped: boolean;
  last_row_at: number | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function at(row: SessionLedgerRow): number | null {
  const parsed = Date.parse(rowRecordedAt(row) ?? '');
  return Number.isNaN(parsed) ? null : parsed;
}

function isDevelopmentRow(row: SessionLedgerRow, kind: string): boolean {
  return row.kind === kind && (row as Record<string, unknown>).stage === 'development';
}

function lastIndexOf(
  rows: readonly SessionLedgerRow[],
  match: (row: SessionLedgerRow) => boolean,
): number {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i]!)) return i;
  return -1;
}

export function currentDevelopmentRows(
  rows: readonly SessionLedgerRow[],
): readonly SessionLedgerRow[] {
  const lastStart = lastIndexOf(rows, (row) => isDevelopmentRow(row, 'stage_start'));
  if (lastStart < 0) return rows;
  const boundary = lastIndexOf(rows.slice(0, lastStart), (row) =>
    isDevelopmentRow(row, 'stage_end'),
  );
  return boundary < 0 ? rows : rows.slice(boundary + 1);
}

export function developmentEnded(rows: readonly SessionLedgerRow[]): boolean {
  const lastStart = lastIndexOf(rows, (row) => isDevelopmentRow(row, 'stage_start'));
  return rows.slice(lastStart + 1).some((row) => isDevelopmentRow(row, 'stage_end'));
}

export function foldSlices(allRows: readonly SessionLedgerRow[]): Map<string, SliceState> {
  const rows = currentDevelopmentRows(allRows);
  const slices = new Map<string, SliceState>();
  const byAgent = new Map<string, string>();
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const id = str(record.workstream);
    const agentId = str(record.agent_id);
    if (row.kind === SLICE_START_KIND && id) {
      const previous = slices.get(id);
      slices.set(id, {
        id,
        agent_id: agentId,
        started_at: previous?.started_at ?? rowRecordedAt(row) ?? null,
        last_started_at: rowRecordedAt(row) ?? null,
        done_at: null,
        gate_failures: 0,
        last_gate_passed: null,
        last_gate_digest: null,
        last_gate_failures: [],
        done: false,
        stopped: false,
        last_row_at: at(row),
      });
      if (agentId) byAgent.set(agentId, id);
      continue;
    }
    const target = id
      ? slices.get(id)
      : agentId
        ? slices.get(byAgent.get(agentId) ?? '')
        : undefined;
    if (!target) continue;
    if (agentId && agentId === target.agent_id) target.last_row_at = at(row) ?? target.last_row_at;
    if (row.kind === SLICE_GATE_KIND && id) {
      const passed = record.event_status === 'completed';
      target.last_gate_passed = passed;
      target.last_gate_digest = str(record.digest);
      target.last_gate_failures = Array.isArray(record.failures)
        ? (record.failures as string[])
        : [];
      if (!passed) target.gate_failures += 1;
    } else if (row.kind === SLICE_DONE_KIND && id) {
      target.done = true;
      target.done_at = rowRecordedAt(row) ?? null;
    } else if (AGENT_STOP_KINDS.has(String(row.kind)) && agentId === target.agent_id) {
      target.stopped = true;
    }
  }
  return slices;
}

export function sliceOfAgent(
  rows: readonly SessionLedgerRow[],
  agentId: string | null | undefined,
): string | null {
  if (!agentId) return null;
  let found: string | null = null;
  for (const row of currentDevelopmentRows(rows)) {
    const record = row as Record<string, unknown>;
    if (row.kind === SLICE_START_KIND && record.agent_id === agentId) {
      found = str(record.workstream);
    }
  }
  return found;
}

export function sliceIsDead(state: SliceState, nowMs: number): boolean {
  if (state.done) return false;
  if (state.stopped) return true;
  return state.last_row_at !== null && nowMs - state.last_row_at >= DEAD_SLICE_MS;
}

export const SLICE_DROP_OPTION = 'drop';

export function droppedSlices(
  projectRoot: string,
  dirName: string,
  rows: readonly SessionLedgerRow[],
): Set<string> {
  const key = featureChangeKey(dirName);
  const states = foldSlices(rows);
  const dropped = new Set<string>();
  for (const { packet, status } of readContractDecisions(projectRoot)) {
    const record = packet as unknown as Record<string, unknown>;
    if (status !== 'resolved' || record.chosen !== SLICE_DROP_OPTION) continue;
    if (record.change !== key || typeof packet.workstream !== 'string') continue;
    const state = states.get(packet.workstream);
    if (!state || state.done) continue;
    const resolvedAt = Date.parse(String(record.resolved_at ?? ''));
    const startedAt = Date.parse(state.last_started_at ?? '');
    if (Number.isNaN(resolvedAt) || (!Number.isNaN(startedAt) && resolvedAt < startedAt)) continue;
    dropped.add(packet.workstream);
  }
  return dropped;
}

const NONE: ReadonlySet<string> = new Set();

export function runningSlices(
  rows: readonly SessionLedgerRow[],
  nowMs: number,
  dropped: ReadonlySet<string> = NONE,
): SliceState[] {
  return [...foldSlices(rows).values()].filter(
    (s) => !s.done && !dropped.has(s.id) && !sliceIsDead(s, nowMs),
  );
}

export function deadSlices(
  rows: readonly SessionLedgerRow[],
  nowMs: number,
  dropped: ReadonlySet<string> = NONE,
): SliceState[] {
  return [...foldSlices(rows).values()].filter((s) => !dropped.has(s.id) && sliceIsDead(s, nowMs));
}

export function sliceStartRefusal(
  slicing: CompiledSlicing | null,
  id: string,
  rows: readonly SessionLedgerRow[],
  nowMs: number,
): string | null {
  if (slicing === null) {
    return `no compiled plan with workstreams, so slice "${id}" cannot start; run \`paqad-ai plan compile\` first`;
  }
  if (!sliceIds(slicing).includes(id)) {
    return `"${id}" is not a workstream or joining entry of the compiled plan`;
  }
  const state = foldSlices(rows).get(id);
  if (state && !state.done && !sliceIsDead(state, nowMs)) {
    return `slice "${id}" is already running under agent ${state.agent_id ?? 'unknown'}`;
  }
  return null;
}

export function sliceDoneRefusal(
  rows: readonly SessionLedgerRow[],
  id: string,
  currentDigest: string,
): string | null {
  const state = foldSlices(rows).get(id);
  if (!state) return `slice "${id}" has no slice_start row`;
  if (state.last_gate_passed !== true) {
    return `slice "${id}" has no passed slice gate; run \`paqad-ai stage slice gate ${id}\``;
  }
  if (state.last_gate_digest !== currentDigest) {
    return `slice "${id}" changed since its last passed gate; run the gate again`;
  }
  return null;
}

export function openSeams(
  slicing: CompiledSlicing,
  rows: readonly SessionLedgerRow[],
  dropped: ReadonlySet<string> = NONE,
): string[] {
  const states = foldSlices(rows);
  const open: string[] = [];
  for (const ws of slicing.workstreams) {
    if (dropped.has(ws.id)) continue;
    for (const seam of ws.provides_seams) {
      const entry = seamJoiningEntry(seam, slicing.joining);
      const closer = entry?.id ?? ws.id;
      if (dropped.has(closer)) continue;
      if (!states.get(closer)?.done) open.push(seam.name);
    }
  }
  return open;
}

export function blockedSlices(
  slicing: CompiledSlicing,
  rows: readonly SessionLedgerRow[],
): SliceState[] {
  return [...foldSlices(rows).values()].filter(
    (s) => !s.done && sliceOutOfAttempts(sliceRisk(slicing, s.id), s.gate_failures),
  );
}

export type EndDevelopmentRefusal =
  | { kind: 'slice-agent'; workstream: string; message: string }
  | { kind: 'lead'; slices: string[]; seams: string[]; message: string };

export function developmentEndRefusal(
  slicing: CompiledSlicing | null,
  rows: readonly SessionLedgerRow[],
  agentId: string | null | undefined,
  dropped: ReadonlySet<string> = NONE,
): EndDevelopmentRefusal | null {
  const states = foldSlices(rows);
  if (states.size === 0) return null;
  const own = sliceOfAgent(rows, agentId);
  if (own !== null) {
    return {
      kind: 'slice-agent',
      workstream: own,
      message: `a slice agent cannot end development; run \`paqad-ai stage slice done ${own}\` and return`,
    };
  }
  const open = [...states.values()].filter((s) => !s.done && !dropped.has(s.id)).map((s) => s.id);
  const seams = slicing ? openSeams(slicing, rows, dropped) : [];
  if (open.length === 0 && seams.length === 0) return null;
  const parts: string[] = [];
  if (open.length > 0) parts.push(`slices not done: ${open.join(', ')}`);
  if (seams.length > 0) parts.push(`open seams: ${seams.join(', ')}`);
  return {
    kind: 'lead',
    slices: open,
    seams,
    message: `development cannot end yet — ${parts.join('; ')}`,
  };
}

export function sliceEndRefusedRow(
  refusal: Extract<EndDevelopmentRefusal, { kind: 'slice-agent' }>,
  agentId: string,
) {
  return {
    kind: SLICE_END_REFUSED_KIND,
    agent: 'paqad-development',
    agent_id: agentId,
    workstream: refusal.workstream,
    stage: 'development',
    refusal_id: ulid(),
  };
}

export interface SliceView {
  id: string;
  risk: WorkstreamRisk;
  model: string;
  effort: string;
  gate_failures: number;
  escalated: boolean;
}

export function slicesView(
  slicing: CompiledSlicing,
  rows: readonly SessionLedgerRow[],
): SliceView[] {
  const states = foldSlices(rows);
  return slicing.workstreams.map((ws) => {
    const failures = states.get(ws.id)?.gate_failures ?? 0;
    return { id: ws.id, risk: ws.risk, gate_failures: failures, ...sliceModel(ws.risk, failures) };
  });
}

export interface SliceReportRow {
  id: string;
  status: 'DONE' | 'BLOCKED' | 'RUNNING';
  wall_clock_ms: number | null;
  gate_failures: number;
  escalated: boolean;
}

export function sliceReport(
  slicing: CompiledSlicing,
  rows: readonly SessionLedgerRow[],
): SliceReportRow[] {
  return [...foldSlices(rows).values()].map((s) => {
    const risk = sliceRisk(slicing, s.id);
    const start = Date.parse(s.started_at ?? '');
    const end = Date.parse(s.done_at ?? '');
    return {
      id: s.id,
      status: s.done ? 'DONE' : sliceOutOfAttempts(risk, s.gate_failures) ? 'BLOCKED' : 'RUNNING',
      wall_clock_ms: Number.isNaN(start) || Number.isNaN(end) ? null : end - start,
      gate_failures: s.gate_failures,
      escalated: sliceModel(risk, s.gate_failures).escalated,
    };
  });
}

export interface FanOutResume {
  kept: string[];
  redispatch: Array<{ id: string; handback: string }>;
  line: string;
}

export function sliceProgressFile(id: string): string {
  return `.paqad/tmp/slice-${id}-progress.md`;
}

export function resumeFanOut(rows: readonly SessionLedgerRow[]): FanOutResume {
  const states = [...foldSlices(rows).values()];
  const kept = states.filter((s) => s.done).map((s) => s.id);
  const redispatch = states
    .filter((s) => !s.done)
    .map((s) => ({ id: s.id, handback: sliceProgressFile(s.id) }));
  return {
    kept,
    redispatch,
    line: `resumed the fan-out: kept ${kept.length} done slice(s)${kept.length ? ` (${kept.join(', ')})` : ''}, dispatch ${redispatch.length} again${redispatch.length ? ` (${redispatch.map((r) => r.id).join(', ')})` : ''}`,
  };
}

export function workstreamOfFile(slicing: CompiledSlicing, file: string): string | null {
  return slicing.workstreams.find((w) => ownsFile(w, file))?.id ?? null;
}

export function packetBlocksFile(
  slicing: CompiledSlicing,
  packetWorkstream: string,
  file: string,
): boolean {
  const owner = slicing.workstreams.find((w) => ownsFile(w, file));
  if (!owner) return true;
  if (owner.id === packetWorkstream) return true;
  const source = slicing.workstreams.find((w) => w.id === packetWorkstream);
  const provided = new Set((source?.provides_seams ?? []).map((seam) => seam.name));
  return owner.uses_seams.some((seam) => provided.has(seam));
}

export interface ScopedPacket {
  id: string;
  workstream: string | null;
}

export function scopedPacketsBlocking(input: {
  projectRoot: string;
  sessionId: string;
  packets: readonly ScopedPacket[];
  targets: readonly string[];
  now?: () => Date;
}): string[] {
  const dirName = currentFeature(input.projectRoot, input.sessionId);
  const slicing = dirName ? readCompiledSlicing(input.projectRoot, dirName) : null;
  const files = input.targets.map((target) => {
    const rel = isAbsolute(target) ? relative(input.projectRoot, target) : target;
    return rel.split(sep).join('/');
  });
  const blocking: string[] = [];
  const allowedBy: ScopedPacket[] = [];
  for (const packet of input.packets) {
    const blocks =
      packet.workstream === null ||
      slicing === null ||
      files.length === 0 ||
      files.some((file) => packetBlocksFile(slicing, packet.workstream!, file));
    if (blocks) blocking.push(packet.id);
    else allowedBy.push(packet);
  }
  if (blocking.length === 0 && allowedBy.length > 0 && dirName !== null) {
    for (const packet of allowedBy) {
      appendFeatureStageRow(
        input.projectRoot,
        input.sessionId,
        dirName,
        {
          kind: SLICE_EDIT_ALLOWED_KIND,
          agent: 'paqad-ai',
          workstream: packet.workstream!,
          decision: packet.id,
          files,
          refusal_id: `${packet.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        input.now,
      );
    }
  }
  return blocking;
}

export const SLICE_SCRATCH_ROOT = '.paqad/tmp/';

export interface SliceWriteRefusal {
  workstream: string;
  target: string;
}

export function sliceWriteRefusal(input: {
  projectRoot: string;
  dirName: string;
  agentId: string | null | undefined;
  targets: readonly string[];
}): SliceWriteRefusal | null {
  if (!input.agentId) return null;
  const rows = readFeatureStageUnit(input.projectRoot, input.dirName);
  const workstream = sliceOfAgent(rows, input.agentId);
  if (workstream === null) return null;
  const slicing = readCompiledSlicing(input.projectRoot, input.dirName);
  if (slicing === null) return null;
  const owned =
    workstream === LINT_CLEANUP_ID
      ? [...slicing.workstreams, ...slicing.joining].flatMap((entry) => entry.owned_files)
      : (sliceOwnedFiles(slicing, workstream) ?? []);
  for (const target of input.targets) {
    const rel = (isAbsolute(target) ? relative(input.projectRoot, target) : target)
      .split(sep)
      .join('/');
    if (rel.startsWith('../') || isAbsolute(rel)) continue;
    if (rel.startsWith(SLICE_SCRATCH_ROOT)) continue;
    if (!ownsFile({ owned_files: owned }, rel)) return { workstream, target: rel };
  }
  return null;
}

export function formatSliceWriteRefusal(refusal: SliceWriteRefusal): string {
  return (
    `**▸ paqad** · write blocked: slice \`${refusal.workstream}\` writes only its own files\n` +
    `> 🔴 Needs your attention: \`${refusal.target}\` is outside the owned files of slice ` +
    `\`${refusal.workstream}\` in plan.json. A slice agent edits only its workstream's owned files ` +
    `and its progress file under \`${SLICE_SCRATCH_ROOT}\`; lead-owned files belong to the lead.`
  );
}

const STAGE_END_DEVELOPMENT = /\bstage\s+end\s+development\b/;

export function sliceEndCommandRefusal(input: {
  projectRoot: string;
  sessionId: string | null | undefined;
  agentId: unknown;
  command: unknown;
}): string | null {
  if (typeof input.agentId !== 'string' || input.agentId.trim() === '') return null;
  if (typeof input.command !== 'string' || !STAGE_END_DEVELOPMENT.test(input.command)) return null;
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId ?? null);
  const dirName = currentFeature(input.projectRoot, sessionId);
  if (dirName === null) return null;
  const rows = readFeatureStageUnit(input.projectRoot, dirName);
  const workstream = sliceOfAgent(rows, input.agentId);
  if (workstream === null) return null;
  const refusal = developmentEndRefusal(null, rows, input.agentId);
  if (refusal?.kind !== 'slice-agent') return null;
  appendFeatureStageRow(
    input.projectRoot,
    sessionId,
    dirName,
    sliceEndRefusedRow(refusal, input.agentId),
  );
  return refusal.message;
}
