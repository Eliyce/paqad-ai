import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  EVIDENCE_LEDGER_SCHEMA_VERSION,
  type EvidenceLedgerRow,
} from '@/core/types/evidence-ledger.js';

export type EvidenceRowIdentity = Pick<
  EvidenceLedgerRow,
  'engine' | 'code' | 'subject_digest' | 'verdict' | 'strength_class'
>;

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
  skip_kind?: EvidenceLedgerRow['skip_kind'];
}

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
    ...(row.skip_kind !== undefined && row.verdict === 'skipped'
      ? { skip_kind: row.skip_kind }
      : {}),
  };
}

function ledgerPath(projectRoot: string): string {
  return join(projectRoot, PATHS.EVIDENCE_LEDGER);
}

export function appendEvidenceRows(projectRoot: string, rows: readonly EvidenceLedgerRow[]): void {
  if (rows.length === 0) return;
  const path = ledgerPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  appendFileSync(path, payload, 'utf8');
}

export function readEvidenceRowsAt(projectRoot: string, relPath: string): EvidenceLedgerRow[] {
  const path = join(projectRoot, relPath);
  if (!existsSync(path)) return [];
  return parseEvidenceRows(readFileSync(path, 'utf8'));
}

export function parseEvidenceRows(raw: string): EvidenceLedgerRow[] {
  const out: EvidenceLedgerRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as EvidenceLedgerRow & { recorded_at?: unknown };
      if (isEvidenceLedgerRow(parsed)) {
        out.push(
          typeof parsed.ts === 'string' ? parsed : { ...parsed, ts: parsed.recorded_at as string },
        );
      }
    } catch {}
  }
  return out;
}

export function readEvidenceLedger(projectRoot: string): EvidenceLedgerRow[] {
  return readEvidenceRowsAt(projectRoot, PATHS.EVIDENCE_LEDGER);
}

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
    (typeof row.ts === 'string' || typeof row.recorded_at === 'string') &&
    typeof row.engine === 'string' &&
    typeof row.code === 'string' &&
    typeof row.subject_digest === 'string' &&
    typeof row.verdict === 'string' &&
    typeof row.strength_class === 'string' &&
    typeof row.content_hash === 'string'
  );
}
