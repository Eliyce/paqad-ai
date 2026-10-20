import { readProjectEvents, recordProjectEvent } from '@/session-ledger/project-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import type { ChangeMetrics } from './types.js';

export const CHANGE_METRICS_DOC_TYPE = 'change-metrics';
export const CHANGE_METRICS_SCHEMA_VERSION = 1;

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

export function readChangeMetricsRows(projectRoot: string, limit: number): SessionLedgerRow[] {
  const rows = readProjectEvents(projectRoot, CHANGE_METRICS_DOC_TYPE).filter(
    (row) => row.kind !== 'open',
  );
  return limit >= rows.length ? rows : rows.slice(rows.length - limit);
}
