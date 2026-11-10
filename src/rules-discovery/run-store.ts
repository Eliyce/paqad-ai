import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteJson, readJsonFile } from './files.js';
import { RULES_DISCOVERY_DIR, absRunFile, isRunId, mintRunId } from './paths.js';

export const RUN_STEPS = [
  'inventory',
  'decisions',
  'research',
  'propose',
  'sign_off',
  'apply',
  'docs',
  'done',
] as const;
export type RunStep = (typeof RUN_STEPS)[number];
export type RunStatus = 'open' | 'done' | 'abandoned';

export const RUN_DOC_TYPE = 'paqad.rules-discovery.run';

export interface RunRecord {
  schema_version: 1;
  doc_type: typeof RUN_DOC_TYPE;
  run_id: string;
  revision: number;
  step: RunStep;
  status: RunStatus;
  opened_at: string;
  updated_at: string;
  signoff_decision: string | null;
  proposal_hash: string | null;
  steps: Array<{ step: RunStep; at: string }>;
}

export type RunRead =
  | { state: 'missing' }
  | { state: 'unreadable'; reason: string }
  | { state: 'ok'; record: RunRecord };

export type RunUpdateResult =
  | { ok: true; record: RunRecord }
  | {
      ok: false;
      reason: 'missing' | 'unreadable' | 'revision-mismatch' | 'closed' | 'step-backwards';
      detail: string;
    };

export interface RunPatch {
  step?: RunStep;
  status?: RunStatus;
  signoff_decision?: string | null;
  proposal_hash?: string | null;
}

function stepIndex(step: RunStep): number {
  return RUN_STEPS.indexOf(step);
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.doc_type === RUN_DOC_TYPE &&
    typeof record.run_id === 'string' &&
    typeof record.revision === 'number' &&
    typeof record.step === 'string' &&
    (RUN_STEPS as readonly string[]).includes(record.step) &&
    (record.status === 'open' || record.status === 'done' || record.status === 'abandoned')
  );
}

export function readRun(projectRoot: string, runId: string): RunRead {
  if (!isRunId(runId)) {
    return { state: 'unreadable', reason: `"${runId}" is not a rules discovery run id` };
  }
  const read = readJsonFile<unknown>(absRunFile(projectRoot, runId, 'run'));
  if (read.state === 'missing') return { state: 'missing' };
  if (read.state === 'unreadable') return { state: 'unreadable', reason: read.error };
  if (!isRunRecord(read.value)) {
    return { state: 'unreadable', reason: 'run.json does not hold a rules discovery run' };
  }
  return { state: 'ok', record: read.value };
}

export function listRunIds(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, RULES_DISCOVERY_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isRunId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function findOpenRunId(projectRoot: string): string | null {
  const open = listRunIds(projectRoot).filter((runId) => {
    const read = readRun(projectRoot, runId);
    return read.state !== 'ok' || read.record.status === 'open';
  });
  return open.length === 0 ? null : open[open.length - 1]!;
}

export function openRun(projectRoot: string, now: Date = new Date()): RunRecord {
  let runId = mintRunId(now);
  for (let suffix = 2; readRun(projectRoot, runId).state !== 'missing'; suffix += 1) {
    runId = mintRunId(now, String(suffix));
  }
  const at = now.toISOString();
  const record: RunRecord = {
    schema_version: 1,
    doc_type: RUN_DOC_TYPE,
    run_id: runId,
    revision: 1,
    step: 'inventory',
    status: 'open',
    opened_at: at,
    updated_at: at,
    signoff_decision: null,
    proposal_hash: null,
    steps: [{ step: 'inventory', at }],
  };
  atomicWriteJson(absRunFile(projectRoot, runId, 'run'), record);
  return record;
}

export function updateRun(
  projectRoot: string,
  runId: string,
  expectedRevision: number,
  patch: RunPatch,
  now: Date = new Date(),
): RunUpdateResult {
  const read = readRun(projectRoot, runId);
  if (read.state === 'missing') {
    return { ok: false, reason: 'missing', detail: `run ${runId} has no run.json` };
  }
  if (read.state === 'unreadable') {
    return { ok: false, reason: 'unreadable', detail: read.reason };
  }
  const current = read.record;
  if (current.revision !== expectedRevision) {
    return {
      ok: false,
      reason: 'revision-mismatch',
      detail: `run ${runId} is at revision ${current.revision}, expected ${expectedRevision}; another session changed it`,
    };
  }
  if (current.status !== 'open') {
    return { ok: false, reason: 'closed', detail: `run ${runId} is ${current.status}` };
  }
  if (patch.step !== undefined && stepIndex(patch.step) < stepIndex(current.step)) {
    return {
      ok: false,
      reason: 'step-backwards',
      detail: `run ${runId} is at ${current.step} and cannot go back to ${patch.step}`,
    };
  }
  const at = now.toISOString();
  const step = patch.step ?? current.step;
  const record: RunRecord = {
    ...current,
    revision: current.revision + 1,
    step,
    status: patch.status ?? (step === 'done' ? 'done' : current.status),
    updated_at: at,
    signoff_decision:
      patch.signoff_decision === undefined ? current.signoff_decision : patch.signoff_decision,
    proposal_hash: patch.proposal_hash === undefined ? current.proposal_hash : patch.proposal_hash,
    steps: step === current.step ? current.steps : [...current.steps, { step, at }],
  };
  atomicWriteJson(absRunFile(projectRoot, runId, 'run'), record);
  return { ok: true, record };
}
