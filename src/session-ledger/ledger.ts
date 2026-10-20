import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export interface SessionLedgerRow {
  schema_version: number;
  doc_type: string;
  session_id: string;
  ts: string;
  content_hash: string;
  [key: string]: unknown;
}

export type SessionRowValidator = (row: SessionLedgerRow) => string[];

export function sessionLedgerDir(docType: string, sessionId: string): string {
  return join(PATHS.EVIDENCE_LEDGER_DIR, docType, sessionId);
}

export function sessionLedgerPath(docType: string, sessionId: string, ordinal: number): string {
  return join(sessionLedgerDir(docType, sessionId), `${ordinal}.jsonl`);
}

export function sessionOpenPointerPath(docType: string, sessionId: string): string {
  return join(sessionLedgerDir(docType, sessionId), '.open');
}

function absDir(projectRoot: string, docType: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(docType, sessionId));
}

function highestOrdinal(dir: string): number {
  let max = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const match = /^(\d+)\.jsonl$/.exec(entry);
    if (match) {
      const n = Number(match[1]);
      if (n > max) {
        max = n;
      }
    }
  }
  return max;
}

export function allocateOrdinal(projectRoot: string, docType: string, sessionId: string): number {
  const dir = absDir(projectRoot, docType, sessionId);
  mkdirSync(dir, { recursive: true });
  let ordinal = highestOrdinal(dir) + 1;
  for (;;) {
    const path = join(dir, `${ordinal}.jsonl`);
    try {
      closeSync(openSync(path, 'wx'));
      writeFileSync(join(dir, '.open'), String(ordinal), 'utf8');
      return ordinal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        ordinal++;
        continue;
      }
      throw error;
    }
  }
}

export function closeSessionOrdinal(projectRoot: string, docType: string, sessionId: string): void {
  const pointer = join(projectRoot, sessionOpenPointerPath(docType, sessionId));
  try {
    writeFileSync(pointer, '0', 'utf8');
  } catch {}
}

export function currentOrdinal(projectRoot: string, docType: string, sessionId: string): number {
  try {
    const raw = readFileSync(join(projectRoot, sessionOpenPointerPath(docType, sessionId)), 'utf8');
    const n = Number(raw.trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

const HASH_EXCLUDED_KEYS = new Set(['ts', 'recorded_at', 'content_hash', 'note']);

export function computeSessionRowHash(row: Record<string, unknown>): string {
  const identity: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    if (!HASH_EXCLUDED_KEYS.has(key)) {
      identity[key] = row[key];
    }
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export interface AppendOptions {
  schemaVersion?: number;
  validate?: SessionRowValidator;
  now?: () => Date;
}

export function stampSessionRow(
  docType: string,
  sessionId: string,
  row: Record<string, unknown>,
  options: AppendOptions = {},
): SessionLedgerRow {
  const now = options.now ?? (() => new Date());
  const base: Record<string, unknown> = {
    schema_version: options.schemaVersion ?? 1,
    doc_type: docType,
    session_id: sessionId,
    ...row,
  };
  const content_hash = computeSessionRowHash(base);
  const stamped: SessionLedgerRow = {
    ...(base as SessionLedgerRow),
    ts: now().toISOString(),
    content_hash,
  };
  if (options.validate) {
    const errors = options.validate(stamped);
    if (errors.length > 0) {
      throw new Error(`Invalid ${docType} row: ${errors.join('; ')}`);
    }
  }
  return stamped;
}

export function appendStampedRowToUnit(
  projectRoot: string,
  unitRelPath: string,
  stamped: SessionLedgerRow,
): void {
  const abs = join(projectRoot, unitRelPath);
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, `${JSON.stringify(stamped)}\n`, 'utf8');
}

export function readUnitFile(projectRoot: string, unitRelPath: string): SessionLedgerRow[] {
  return readJsonl(join(projectRoot, unitRelPath));
}

export function appendSessionEvent(
  projectRoot: string,
  docType: string,
  sessionId: string,
  ordinal: number,
  row: Record<string, unknown>,
  options: AppendOptions = {},
): SessionLedgerRow {
  const stamped = stampSessionRow(docType, sessionId, row, options);
  appendStampedRowToUnit(projectRoot, sessionLedgerPath(docType, sessionId, ordinal), stamped);
  return stamped;
}

export interface OpenSessionDocResult {
  ordinal: number;
  path: string;
}

export function openSessionDoc(
  projectRoot: string,
  docType: string,
  sessionId: string,
  openRow: Record<string, unknown> = {},
  options: AppendOptions = {},
): OpenSessionDocResult {
  const ordinal = allocateOrdinal(projectRoot, docType, sessionId);
  appendSessionEvent(
    projectRoot,
    docType,
    sessionId,
    ordinal,
    { kind: 'open', conversation_ordinal: ordinal, ...openRow },
    options,
  );
  return { ordinal, path: sessionLedgerPath(docType, sessionId, ordinal) };
}

export function readSessionUnit(
  projectRoot: string,
  docType: string,
  sessionId: string,
  ordinal: number,
): SessionLedgerRow[] {
  return readJsonl(join(projectRoot, sessionLedgerPath(docType, sessionId, ordinal)));
}

export function readSessionDoc(
  projectRoot: string,
  docType: string,
  sessionId: string,
): SessionLedgerRow[] {
  const dir = absDir(projectRoot, docType, sessionId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const ordinals = entries
    .map((entry) => /^(\d+)\.jsonl$/.exec(entry))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  return ordinals.flatMap((ordinal) => readSessionUnit(projectRoot, docType, sessionId, ordinal));
}

export function listSessionIds(projectRoot: string, docType: string): string[] {
  const dir = join(projectRoot, PATHS.EVIDENCE_LEDGER_DIR, docType);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function readAllSessionRows(projectRoot: string, docType: string): SessionLedgerRow[] {
  return listSessionIds(projectRoot, docType).flatMap((sessionId) =>
    readSessionDoc(projectRoot, docType, sessionId),
  );
}

export function foldByOrdinal(rows: readonly SessionLedgerRow[]): Map<number, SessionLedgerRow[]> {
  const byOrdinal = new Map<number, SessionLedgerRow[]>();
  for (const row of rows) {
    const ordinal = typeof row.conversation_ordinal === 'number' ? row.conversation_ordinal : 0;
    const bucket = byOrdinal.get(ordinal);
    if (bucket) {
      bucket.push(row);
    } else {
      byOrdinal.set(ordinal, [row]);
    }
  }
  return new Map([...byOrdinal.entries()].sort((a, b) => a[0] - b[0]));
}

function readJsonl(absPath: string): SessionLedgerRow[] {
  if (!existsSync(absPath)) {
    return [];
  }
  const out: SessionLedgerRow[] = [];
  for (const line of readFileSync(absPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as SessionLedgerRow;
      if (isSessionLedgerRow(parsed)) {
        out.push(parsed);
      }
    } catch {}
  }
  return out;
}

function isSessionLedgerRow(value: unknown): value is SessionLedgerRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.doc_type === 'string' &&
    typeof row.session_id === 'string' &&
    (typeof row.ts === 'string' || typeof row.recorded_at === 'string') &&
    typeof row.content_hash === 'string'
  );
}
