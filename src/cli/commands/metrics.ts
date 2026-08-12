import { Command } from 'commander';

import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';
import { readFeatureChangeMetricsWindow } from '@/feature-evidence/projections.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

/**
 * `paqad-ai metrics report` — print the per-change shape metrics for the last N changes
 * (issue #362). It reads the change-metrics rows the completion seam recorded (zero model
 * tokens, no scan) and renders a plain-words trend plus a compact table, so the "less, better
 * code" claim is visible without the dashboard. `--json` emits the machine-readable window.
 */
export function createMetricsCommand(): Command {
  const command = new Command('metrics').description(
    'Report the per-change shape metrics (duplication on new code + cross-file reuse rate)',
  );

  command
    .command('report')
    .description('Print the last N changes’ duplication + reuse metrics and their trend')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--limit <n>', 'How many recent changes to include', '20')
    .option('--json', 'Emit the machine-readable window instead of the human summary', false)
    .action((options: { projectRoot: string; limit: string; json: boolean }) => {
      if (isFrameworkDisabledForRoot(options.projectRoot)) {
        console.error('paqad is disabled (vanilla mode); no change metrics are recorded.\n');
        return;
      }
      const limit = Math.max(1, Number.parseInt(options.limit, 10) || 20);
      const rows = readFeatureChangeMetricsWindow(options.projectRoot, limit);

      if (options.json) {
        console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
        return;
      }
      printReport(rows);
    });

  return command;
}

/** A numeric metric field on a row, or null when it was recorded as n/a. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Mean of the numeric values, or null when none are numeric. */
function mean(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null);
  if (nums.length === 0) {
    return null;
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

/**
 * The direction of a series: compare the mean of its first half to its second half. Fewer than
 * two numeric points cannot show a direction, so it reads `flat` — never an invented trend.
 */
export function trendOf(values: Array<number | null>): 'rising' | 'falling' | 'flat' {
  const nums = values.filter((value): value is number => value !== null);
  if (nums.length < 2) {
    return 'flat';
  }
  const mid = Math.floor(nums.length / 2);
  const first = mean(nums.slice(0, mid));
  const second = mean(nums.slice(mid));
  if (first === null || second === null || first === second) {
    return 'flat';
  }
  return second > first ? 'rising' : 'falling';
}

/** Render the paqad-voice human report for a window of change-metrics rows. */
function printReport(rows: SessionLedgerRow[]): void {
  if (rows.length === 0) {
    console.log('**▸ paqad** · change shape: no changes measured yet.');
    return;
  }

  const dupSeries = rows.map((row) => numberOrNull(row.dup_new_pct));
  const reuseSeries = rows.map((row) => numberOrNull(row.reuse_rate));
  const avgDup = mean(dupSeries);
  const avgReuse = mean(reuseSeries);
  const dupText = avgDup === null ? 'n/a' : `${Math.round(avgDup)}%`;
  const reuseText = avgReuse === null ? 'n/a' : avgReuse.toFixed(1);

  console.log(`**▸ paqad** · change shape (last ${rows.length} changes)`);
  console.log(
    `> Over your last ${rows.length} changes, ${dupText} of new code duplicated existing code ` +
      `(industry drift: rising; your trend: ${trendOf(dupSeries)}).`,
  );
  console.log(
    `> Reuse held at ${reuseText} cross-file calls /100 lines (your trend: ${trendOf(reuseSeries)}).`,
  );
  console.log('>');
  console.log('> | change | duplication | reuse /100 | meaningful lines |');
  console.log('> | --- | --- | --- | --- |');
  rows.forEach((row, index) => {
    const dup = numberOrNull(row.dup_new_pct);
    const reuse = numberOrNull(row.reuse_rate);
    const lines = numberOrNull(row.meaningful_changed_lines) ?? 0;
    console.log(
      `> | ${index + 1} | ${dup === null ? 'n/a' : `${dup}%`} | ` +
        `${reuse === null ? 'n/a' : reuse.toFixed(1)} | ${lines} |`,
    );
  });
}
