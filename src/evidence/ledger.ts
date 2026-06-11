// Issue #118 — the unified append-only evidence ledger.
//
// Generalised from the PQD-194 skill audit-events writer: append-only JSONL,
// `mkdir -p`, a tolerant reader that skips malformed lines so a mid-crash write
// can't poison reads, and a SHA-256 `content_hash` over each row's identity
// fields for consumer-side de-duplication. One file, every engine writes to it.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  EVIDENCE_LEDGER_SCHEMA_VERSION,
  type EvidenceLedgerRow,
} from '@/core/types/evidence-ledger.js';

/** The fields that define a row's identity (everything but `ts`/`content_hash`/
 *  `detail`). `ts` is excluded so the same finding de-dups across re-runs. */
export type EvidenceRowIdentity = Pick<
  EvidenceLedgerRow,
  'engine' | 'code' | 'subject_digest' | 'verdict' | 'strength_class'
>;

/** SHA-256 hex over a row's identity fields, in a fixed key order. */
export function computeRowContentHash(identity: EvidenceRowIdentity): string {
  const canonical = JSON.stringify([
    identity.engine,
    identity.code,
    identity.subject_digest,
    identity.verdict,
    identity.strength_class,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export interface NewEvidenceRow extends EvidenceRowIdentity {
  ts: string;
  detail?: string;
}

/** Stamp schema version + content hash onto a caller-supplied row. */
export function buildEvidenceRow(row: NewEvidenceRow): EvidenceLedgerRow {
  return {
    schema_version: EVIDENCE_LEDGER_SCHEMA_VERSION,
    ts: row.ts,
    engine: row.engine,
    code: row.code,
    subject_digest: row.subject_digest,
    verdict: row.verdict,
    strength_class: row.strength_class,
    content_hash: computeRowContentHash(row),
    ...(row.detail !== undefined ? { detail: row.detail } : {}),
  };
}

function ledgerPath(projectRoot: string): string {
  return join(projectRoot, PATHS.EVIDENCE_LEDGER);
}

/** Append rows to `.paqad/ledger/evidence.jsonl`, one JSON object per line. */
export function appendEvidenceRows(projectRoot: string, rows: readonly EvidenceLedgerRow[]): void {
  if (rows.length === 0) return;
  const path = ledgerPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  appendFileSync(path, payload, 'utf8');
}

/** Read all ledger rows; malformed or wrong-shaped lines are skipped. */
export function readEvidenceLedger(projectRoot: string): EvidenceLedgerRow[] {
  const path = ledgerPath(projectRoot);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out: EvidenceLedgerRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as EvidenceLedgerRow;
      if (isEvidenceLedgerRow(parsed)) {
        out.push(parsed);
      }
    } catch {
      // Skip partial/corrupt lines (mirrors readSkillAuditEvents): an append-only
      // log must survive a mid-crash write without poisoning the whole reader.
    }
  }
  return out;
}

/** Rows whose `subject_digest` matches a given change — the receipt's window. */
export function readEvidenceWindow(
  projectRoot: string,
  subjectDigest: string,
): EvidenceLedgerRow[] {
  return readEvidenceLedger(projectRoot).filter((row) => row.subject_digest === subjectDigest);
}

function isEvidenceLedgerRow(value: unknown): value is EvidenceLedgerRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.ts === 'string' &&
    typeof row.engine === 'string' &&
    typeof row.code === 'string' &&
    typeof row.subject_digest === 'string' &&
    typeof row.verdict === 'string' &&
    typeof row.strength_class === 'string' &&
    typeof row.content_hash === 'string'
  );
}
