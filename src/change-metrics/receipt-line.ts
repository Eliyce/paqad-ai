// The change-shape receipt line (issue #362, FR-3).
//
// One line on the end-of-change receipt, only for feature-development changes. The verbatim
// format is `> - 📏 change shape: 0% duplicated new code · 4.2 reuse calls /100 lines`; a
// metric with no input renders `n/a` in place of its number, so the line never implies a
// measurement that did not happen (index absent → `n/a` reuse, stated).

import type { ChangeMetrics } from './types.js';

/** Render a duplication percentage: `n/a` when null, else `<n>%` (e.g. `0%`, `10%`, `2.5%`). */
function formatDup(dupNewPct: number | null): string {
  return dupNewPct === null ? 'n/a' : `${dupNewPct}%`;
}

/** Render a reuse rate: `n/a` when null, else one decimal (e.g. `4.2`, `6.0`). */
function formatReuse(reuseRate: number | null): string {
  return reuseRate === null ? 'n/a' : reuseRate.toFixed(1);
}

/** The single change-shape receipt line for a change's metrics. */
export function formatChangeShapeLine(metrics: ChangeMetrics): string {
  return (
    `> - 📏 change shape: ${formatDup(metrics.dup_new_pct)} duplicated new code · ` +
    `${formatReuse(metrics.reuse_rate)} reuse calls /100 lines`
  );
}
