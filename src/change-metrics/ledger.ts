// Change-metrics session-ledger persistence + trend read (issue #362, FR-4/FR-6/FR-7).
//
// Each feature-development change appends one `change-metrics` row onto the project-scoped
// session ledger (the same substrate the duplication telemetry uses). The row carries both
// ratios and their raw inputs, so the dashboard trend and the `metrics report` CLI can read
// the last N changes without recomputation, and the SIEM aggregate folds the doc_type into
// the export (once registered).

import { readProjectEvents, recordProjectEvent } from '@/session-ledger/project-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import type { ChangeMetrics } from './types.js';

export const CHANGE_METRICS_DOC_TYPE = 'change-metrics';
export const CHANGE_METRICS_SCHEMA_VERSION = 1;

/** Append one change-metrics row to the project ledger (best-effort, mirrors recordDuplicationRun). */
export function recordChangeMetrics(projectRoot: string, metrics: ChangeMetrics): void {
  recordProjectEvent(
    projectRoot,
    CHANGE_METRICS_DOC_TYPE,
    {
      dup_new_pct: metrics.dup_new_pct,
      reuse_rate: metrics.reuse_rate,
      meaningful_changed_lines: metrics.meaningful_changed_lines,
      flagged_lines: metrics.inputs.flagged_lines,
      reuse_calls: metrics.inputs.reuse_calls,
    },
    CHANGE_METRICS_SCHEMA_VERSION,
  );
}

/**
 * The last `limit` change-metrics rows, oldest-first. The ledger opens each doc with a
 * `kind:'open'` marker row, so that non-data row is filtered out before the window is taken;
 * rows are appended chronologically, so the tail is the most recent window the trend and the
 * CLI report render.
 */
export function readChangeMetricsRows(projectRoot: string, limit: number): SessionLedgerRow[] {
  const rows = readProjectEvents(projectRoot, CHANGE_METRICS_DOC_TYPE).filter(
    (row) => row.kind !== 'open',
  );
  return limit >= rows.length ? rows : rows.slice(rows.length - limit);
}
