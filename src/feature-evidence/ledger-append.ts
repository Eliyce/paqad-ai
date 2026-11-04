import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  rmdirSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { FileLockTimeoutError, withFileLockSync } from '@/core/fs/file-lock.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { ORCHESTRATOR_AGENT } from '@/stage-evidence/agent-identity.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import { STAGE_EVIDENCE_DOC_TYPE, STAGE_EVIDENCE_SCHEMA_VERSION } from '@/stage-evidence/types.js';

import { stampBundleRow } from './envelope.js';
import { featureChangeKey, featureDir, featureFilePath, parseFeatureDirName } from './paths.js';

export const BUNDLE_LOCK_NAME = '.lock';
export const LEDGER_LOCK_TIMEOUT_MS = 200;
export const LEDGER_LOCK_STALE_MS = 2_000;
export const DEDUPE_WINDOW_MS = 10_000;
export const LOCK_TIMEOUT_NOTE = 'lock-timeout';
export const AFTER_TORN_LINE_NOTE = 'after-torn-line';

const TAIL_BYTES = 256 * 1024;

const BODY_HASH_EXCLUDED: ReadonlySet<string> = new Set([
  'ts',
  'recorded_at',
  'note',
  'prev_hash',
  'chain_note',
  'content_hash',
  'idempotency_key',
  'host_pid',
]);

export function bundleLockPath(projectRoot: string, dirName: string): string {
  return join(projectRoot, featureDir(dirName), BUNDLE_LOCK_NAME);
}

function bodyHash(row: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    if (!BODY_HASH_EXCLUDED.has(key)) body[key] = row[key];
  }
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function textField(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

interface RowKey {
  key: string;
  byValue: boolean;
}

function rowKey(change: string, sessionId: string, row: Record<string, unknown>): RowKey {
  const owner = textField(row.agent_id) ?? sessionId;
  const stage = textField(row.stage) ?? '-';
  const status = textField(row.event_status) ?? '-';
  const id = textField(row.tool_use_id) ?? textField(row.refusal_id);
  const final = id ?? bodyHash(row);
  return {
    key: `${change}:${owner}:${stage}:${String(row.kind)}:${status}:${final}`,
    byValue: id !== null,
  };
}

function readFileTail(path: string): { text: string; endsClean: boolean } {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', endsClean: true };
    throw error;
  }
  try {
    const size = statSync(path).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return { text, endsClean: text === '' || text.endsWith('\n') };
  } finally {
    closeSync(fd);
  }
}

function parseRows(text: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') rows.push(parsed as Record<string, unknown>);
    } catch {}
  }
  return rows;
}

function sameStageMoved(row: Record<string, unknown>, candidate: Record<string, unknown>): boolean {
  return (row.stage ?? null) === (candidate.stage ?? null) && row.kind !== candidate.kind;
}

function existingDuplicate(
  rows: ReadonlyArray<Record<string, unknown>>,
  key: RowKey,
  nowMs: number,
  candidate: Record<string, unknown>,
): Record<string, unknown> | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.idempotency_key !== key.key) {
      if (!key.byValue && sameStageMoved(row, candidate)) return null;
      continue;
    }
    if (key.byValue) return row;
    const at = Date.parse(String(row.recorded_at ?? ''));
    return !Number.isNaN(at) && nowMs - at <= DEDUPE_WINDOW_MS ? row : null;
  }
  return null;
}

function writeLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

interface AppendInput {
  projectRoot: string;
  sessionId: string;
  dirName: string;
  row: Record<string, unknown>;
  now?: () => Date;
}

function appendRow(input: AppendInput, locked: boolean): SessionLedgerRow {
  const { projectRoot, sessionId, dirName, now } = input;
  const row: Record<string, unknown> = {
    ...input.row,
    agent: input.row.agent ?? ORCHESTRATOR_AGENT,
  };
  const path = join(projectRoot, featureFilePath(dirName, 'stageEvidence'));
  const change = featureChangeKey(dirName);
  const key = rowKey(change, sessionId, row);
  const tail = readFileTail(path);
  const rows = parseRows(tail.text);
  const stampedAt = (now ?? (() => new Date()))();
  const duplicate =
    row.kind === 'verify' ? null : existingDuplicate(rows, key, stampedAt.getTime(), row);
  if (duplicate) return duplicate as unknown as SessionLedgerRow;
  const previous = rows.at(-1);
  const chain = {
    prev_hash: locked ? textField(previous?.content_hash) : null,
    ...(locked ? {} : { chain_note: LOCK_TIMEOUT_NOTE }),
    ...(locked && !tail.endsClean ? { chain_note: AFTER_TORN_LINE_NOTE } : {}),
  };
  const stamped = stampBundleRow({
    docType: STAGE_EVIDENCE_DOC_TYPE,
    change,
    sessionId,
    schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
    row: { ...row, idempotency_key: key.key, ...chain },
    validate: (candidate) => validateStageEvidenceRow(candidate),
    now: () => stampedAt,
  });
  writeLine(path, `${tail.endsClean ? '' : '\n'}${JSON.stringify(stamped)}\n`);
  return stamped as unknown as SessionLedgerRow;
}

function renamedBundle(projectRoot: string, dirName: string): string | null {
  if (existsSync(join(projectRoot, featureFilePath(dirName, 'stageEvidence')))) return null;
  const ulid = parseFeatureDirName(dirName)?.ulid;
  if (!ulid) return null;
  const base = dirname(join(projectRoot, featureDir(dirName)));
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  const match = names.find((name) => name !== dirName && parseFeatureDirName(name)?.ulid === ulid);
  return match ?? null;
}

class BundleMoved extends Error {
  constructor(readonly target: string) {
    super(`bundle moved to ${target}`);
  }
}

export function appendChainedStageRow(input: AppendInput): SessionLedgerRow {
  const { projectRoot, dirName } = input;
  const moved = renamedBundle(projectRoot, dirName);
  if (moved !== null) return appendChainedStageRow({ ...input, dirName: moved });
  let entered = false;
  try {
    return withFileLockSync(
      bundleLockPath(projectRoot, dirName),
      () => {
        entered = true;
        const target = renamedBundle(projectRoot, dirName);
        if (target !== null) throw new BundleMoved(target);
        return appendRow(input, true);
      },
      { timeoutMs: LEDGER_LOCK_TIMEOUT_MS, staleMs: LEDGER_LOCK_STALE_MS },
    );
  } catch (error) {
    if (error instanceof BundleMoved) {
      try {
        rmdirSync(join(projectRoot, featureDir(dirName)));
      } catch {}
      return appendChainedStageRow({ ...input, dirName: error.target });
    }
    if (entered && !(error instanceof FileLockTimeoutError)) throw error;
    return appendRow(input, false);
  }
}
