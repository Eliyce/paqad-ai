import type { FixProtocolStatus } from '@/core/types/fix-protocol.js';
import {
  readFeatureIndexEntries,
  writeFeatureIndexDocument,
} from '@/feature-evidence/bundle-document.js';
import { FEATURE_DOC_SCHEMA_VERSION, FIX_PROOF_DOC_TYPE } from '@/feature-evidence/types.js';

export type FixProofPhase = 'red' | 'green';

export type FixProofOutcome =
  'red' | 'not-reproduced' | 'green' | 'still-failing' | 'held' | 'error';

export interface FixProofRow {
  phase: FixProofPhase;
  outcome: FixProofOutcome;
  test_file: string;
  test_id: string;
  command: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  commit: string | null;
  tree_dirty: boolean | null;
  at: string;
  reason: string;
  output_tail: string[];
  baseline_failing?: string[];
  protocol_status?: FixProtocolStatus;
  guard_path?: string;
}

const ROWS_KEY = 'rows';

export function readFixProofRows(projectRoot: string, dirName: string): FixProofRow[] {
  const rows = readFeatureIndexEntries<FixProofRow>(projectRoot, dirName, 'fixProof', ROWS_KEY);
  return (rows ?? []).filter(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      (row.phase === 'red' || row.phase === 'green') &&
      typeof row.outcome === 'string' &&
      typeof row.at === 'string',
  );
}

export function appendFixProofRow(
  projectRoot: string,
  dirName: string,
  row: FixProofRow,
  options: { sessionId?: string | null; now?: () => Date } = {},
): string | null {
  const rows = [...readFixProofRows(projectRoot, dirName), row];
  return writeFeatureIndexDocument({
    projectRoot,
    dirName,
    file: 'fixProof',
    key: ROWS_KEY,
    docType: FIX_PROOF_DOC_TYPE,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    entries: rows,
    sessionId: options.sessionId,
    now: options.now,
  }).path;
}

export function countedRedRow(rows: readonly FixProofRow[]): FixProofRow | null {
  let red: FixProofRow | null = null;
  for (const row of rows) {
    if (row.phase === 'green' && row.outcome === 'green') break;
    if (row.phase === 'red' && row.outcome === 'red') red = row;
  }
  return red;
}
