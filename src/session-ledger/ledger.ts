// Shared session-scoped evidence substrate (issue #249 P0).
//
// A *script-written, session-scoped, append-only JSONL evidence document* with:
//   - atomic ordinal allocation (filesystem exclusive-create, race-safe across the
//     background worker and the prompt seam),
//   - an `.open` pointer to the current ordinal,
//   - a script-clock `ts` and a SHA-256 `content_hash` (identity de-dup) stamped on
//     every row,
//   - a tolerant reader that skips malformed lines so a mid-crash write never poisons
//     reads,
//   - an injectable per-row validator (the consumer plugs its AJV schema).
//
// Layout: `.paqad/ledger/<docType>/<sessionId>/<ordinal>.jsonl`, one file per unit
// (a conversation turn for rag-evidence, a prompt turn for the #247 stage-evidence
// ledger). The `ledger/` root is already git-ignored (gitignore-writer), so no
// gitignore change is needed. This substrate imports no enterprise code — the
// writer is always-on, independent of any AI-BOM / enterprise flag (issue #249 C1).
//
// rag-evidence (#249) and stage-evidence (#247) both consume this ONE primitive
// instead of duplicating it.

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
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

/** The envelope every session-ledger row carries, plus consumer-specific fields. */
export interface SessionLedgerRow {
  schema_version: number;
  doc_type: string;
  session_id: string;
  /** ISO-8601 UTC, stamped by the recorder script (never the LLM). */
  ts: string;
  /** SHA-256 over the row's identity (everything but `ts` / `content_hash` / `note`). */
  content_hash: string;
  [key: string]: unknown;
}

/** Returns `[]` when the row is valid, or a list of human-readable errors. */
export type SessionRowValidator = (row: SessionLedgerRow) => string[];

/** Project-relative directory holding one session's files for a doc type. */
export function sessionLedgerDir(docType: string, sessionId: string): string {
  return join(PATHS.EVIDENCE_LEDGER_DIR, docType, sessionId);
}

/** Project-relative path to one unit's JSONL file. */
export function sessionLedgerPath(docType: string, sessionId: string, ordinal: number): string {
  return join(sessionLedgerDir(docType, sessionId), `${ordinal}.jsonl`);
}

/** Project-relative path to the `.open` pointer (the current ordinal). */
export function sessionOpenPointerPath(docType: string, sessionId: string): string {
  return join(sessionLedgerDir(docType, sessionId), '.open');
}

function absDir(projectRoot: string, docType: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(docType, sessionId));
}

/** Highest ordinal already present in the session dir, or 0 when empty/absent. */
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

/**
 * Atomically allocate the next ordinal for a session by exclusive-creating its JSONL
 * file (`wx`), retrying on collision so two concurrent allocators (background worker
 * vs. prompt seam) never share an ordinal. Updates the `.open` pointer. Returns the
 * allocated ordinal.
 */
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

/** The current (latest-allocated) ordinal from the `.open` pointer, or 0 when none. */
export function currentOrdinal(projectRoot: string, docType: string, sessionId: string): number {
  try {
    const raw = readFileSync(join(projectRoot, sessionOpenPointerPath(docType, sessionId)), 'utf8');
    const n = Number(raw.trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Keys excluded from the identity hash (volatile / non-identifying). */
const HASH_EXCLUDED_KEYS = new Set(['ts', 'content_hash', 'note']);

/** SHA-256 over the row's identity fields, in a stable key order. */
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
  /** Schema version stamped on the envelope. Defaults to 1. */
  schemaVersion?: number;
  /** Per-row validator (the consumer's AJV check). Throws on failure. */
  validate?: SessionRowValidator;
  /** Clock seam for tests. */
  now?: () => Date;
}

/**
 * Stamp the envelope (`schema_version` / `doc_type` / `session_id` / script-clock `ts`
 * / `content_hash`) onto a caller row, validate it, and append one JSONL line to the
 * unit's file. Returns the stamped row. Throws when the validator rejects the row (a
 * script bug, never silently swallowed).
 */
export function appendSessionEvent(
  projectRoot: string,
  docType: string,
  sessionId: string,
  ordinal: number,
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
  const dir = absDir(projectRoot, docType, sessionId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${ordinal}.jsonl`), `${JSON.stringify(stamped)}\n`, 'utf8');
  return stamped;
}

export interface OpenSessionDocResult {
  ordinal: number;
  path: string;
}

/**
 * Allocate the next ordinal and write a `kind:open` row to it. The row's other fields
 * come from `openRow` (e.g. `rag_enabled`, `adapter`). Returns the ordinal + path.
 */
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

/** Tolerant read of one unit's rows (skips malformed lines). */
export function readSessionUnit(
  projectRoot: string,
  docType: string,
  sessionId: string,
  ordinal: number,
): SessionLedgerRow[] {
  return readJsonl(join(projectRoot, sessionLedgerPath(docType, sessionId, ordinal)));
}

/** Tolerant read of every unit's rows for a session, ordinal-ascending. */
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

/** Group a session's rows by their `conversation_ordinal` (ascending). */
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
    } catch {
      // Skip a partial/corrupt line — an append-only log must survive a mid-crash write.
    }
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
    typeof row.ts === 'string' &&
    typeof row.content_hash === 'string'
  );
}
