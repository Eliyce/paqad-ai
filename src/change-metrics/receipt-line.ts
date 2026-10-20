import type { ChangeMetrics } from './types.js';

function formatDup(dupNewPct: number | null): string {
  return dupNewPct === null ? 'n/a' : `${dupNewPct}%`;
}

function formatReuse(reuseRate: number | null): string {
  return reuseRate === null ? 'n/a' : reuseRate.toFixed(1);
}

export function formatChangeShapeLine(metrics: ChangeMetrics): string {
  return (
    `> - 📏 change shape: ${formatDup(metrics.dup_new_pct)} duplicated new code · ` +
    `${formatReuse(metrics.reuse_rate)} reuse calls /100 lines`
  );
}
