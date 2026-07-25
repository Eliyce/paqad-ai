// Change-shape metrics (issue #362) — public surface.
//
// Two deterministic, diff-scoped, zero-model-token metrics per change (duplication on new
// code, cross-file reuse rate), the receipt line that renders them, and the session-ledger
// persistence the dashboard trend and the `metrics report` CLI read.

export { computeChangeMetrics } from './compute.js';
export { formatChangeShapeLine } from './receipt-line.js';
export {
  CHANGE_METRICS_DOC_TYPE,
  CHANGE_METRICS_SCHEMA_VERSION,
  readChangeMetricsRows,
  recordChangeMetrics,
} from './ledger.js';
export type { ChangeMetrics } from './types.js';
