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

export type FixProofState = 'none' | 'red' | 'red-green' | 'green-only' | 'not-reproduced' | 'held';

export const FIX_PROOF_STATE_LABEL: Record<FixProofState, string> = {
  none: 'no proof recorded',
  red: 'fails before the fix, no green yet',
  'red-green': 'fails before the fix, passes after',
  'green-only': 'passes, but never shown failing before the fix',
  'not-reproduced': 'passed before the fix, so it never reproduced the problem',
  held: 'held: the fix broke a check that passed before',
};

export function foldFixProofState(rows: readonly FixProofRow[]): FixProofState {
  const red = countedRedRow(rows);
  if (red !== null) {
    const after = rows.slice(rows.indexOf(red) + 1);
    const settled = after.filter(
      (row) => row.phase === 'green' && (row.outcome === 'green' || row.outcome === 'held'),
    );
    const last = settled.at(-1);
    if (last === undefined) return 'red';
    return last.outcome === 'green' ? 'red-green' : 'held';
  }
  if (rows.some((row) => row.phase === 'green' && row.outcome === 'green')) return 'green-only';
  if (rows.some((row) => row.outcome === 'not-reproduced')) return 'not-reproduced';
  return 'none';
}
