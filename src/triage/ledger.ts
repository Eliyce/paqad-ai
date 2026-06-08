import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  TRIAGE_LEDGER_SCHEMA_VERSION,
  type TriageFinding,
  type TriageLedger,
  type TriageLedgerEntry,
  type TriageVerdict,
} from '@/core/types/triage.js';

// Issue #107 — the triage ledger records each finding's pile + reason so false
// alarms and taste calls are auditable and reusable, and "confirmed → change"
// is traceable. It is a per-run record, not a second decision memory — settle-
// once / never-re-raise lives in the Decision Pause Contract.

function ledgerPath(projectRoot: string): string {
  return join(projectRoot, PATHS.TRIAGE_LEDGER);
}

function emptyLedger(now: string): TriageLedger {
  return {
    schema_version: TRIAGE_LEDGER_SCHEMA_VERSION,
    updated_at: now,
    entries: [],
  };
}

/**
 * Reads the triage ledger, or an empty one if none exists yet. A corrupt file
 * is treated as empty rather than throwing — the ledger is an audit aid and must
 * never block a build.
 */
export async function readTriageLedger(
  projectRoot: string,
  now: string = new Date().toISOString(),
): Promise<TriageLedger> {
  let raw: string;
  try {
    raw = await readFile(ledgerPath(projectRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyLedger(now);
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as TriageLedger;
    if (!Array.isArray(parsed.entries)) {
      return emptyLedger(now);
    }
    return parsed;
  } catch {
    /* v8 ignore next 2 -- corrupt-JSON fallback is covered; the branch itself is defensive */
    return emptyLedger(now);
  }
}

/** Atomically writes the ledger (temp file + rename), creating the dir. */
export async function writeTriageLedger(
  projectRoot: string,
  ledger: TriageLedger,
): Promise<string> {
  const targetPath = ledgerPath(projectRoot);
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, targetPath);

  return targetPath;
}

/** Builds a ledger entry from a finding + its verdict. */
export function toLedgerEntry(
  finding: TriageFinding,
  verdict: TriageVerdict,
  now: string,
): TriageLedgerEntry {
  return {
    finding_id: finding.id,
    source: finding.source,
    kind: finding.kind,
    pile: verdict.pile,
    route: verdict.route,
    ...(verdict.confirmation ? { confirmation: verdict.confirmation } : {}),
    reason: verdict.reason,
    file: finding.file ?? null,
    line: finding.line ?? null,
    recorded_at: now,
  };
}

/**
 * Records a finding's verdict in the ledger, replacing any earlier entry for the
 * same finding id (a re-triaged finding updates in place rather than duplicating).
 */
export function recordVerdict(
  ledger: TriageLedger,
  finding: TriageFinding,
  verdict: TriageVerdict,
  now: string,
): TriageLedger {
  const entry = toLedgerEntry(finding, verdict, now);
  const existingIndex = ledger.entries.findIndex((e) => e.finding_id === finding.id);
  const entries =
    existingIndex === -1
      ? [...ledger.entries, entry]
      : ledger.entries.map((e, i) => (i === existingIndex ? entry : e));
  return { ...ledger, updated_at: now, entries };
}
