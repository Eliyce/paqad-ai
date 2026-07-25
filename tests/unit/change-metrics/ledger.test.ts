import { describe, expect, it } from 'vitest';

import {
  CHANGE_METRICS_DOC_TYPE,
  readChangeMetricsRows,
  recordChangeMetrics,
} from '@/change-metrics/ledger.js';
import type { ChangeMetrics } from '@/change-metrics/types.js';
import { readLatestProjectEvent } from '@/session-ledger/project-ledger.js';

import { makeProject } from './helpers.js';

function metrics(dup: number | null, reuse: number | null, lines: number): ChangeMetrics {
  return {
    dup_new_pct: dup,
    reuse_rate: reuse,
    meaningful_changed_lines: lines,
    inputs: { flagged_lines: 0, reuse_calls: 0, duplication_report_present: true, index_present: true },
  };
}

describe('recordChangeMetrics / readChangeMetricsRows', () => {
  it('appends a change-metrics row carrying both ratios and inputs', () => {
    const root = makeProject();
    recordChangeMetrics(root, metrics(2, 4.2, 120));

    const row = readLatestProjectEvent(root, CHANGE_METRICS_DOC_TYPE, () => true);
    expect(row?.dup_new_pct).toBe(2);
    expect(row?.reuse_rate).toBe(4.2);
    expect(row?.meaningful_changed_lines).toBe(120);
  });

  it('reads the last N rows oldest-first', () => {
    const root = makeProject();
    for (let i = 0; i < 5; i++) {
      recordChangeMetrics(root, metrics(i, null, 10 + i));
    }
    const last3 = readChangeMetricsRows(root, 3);
    expect(last3.map((r) => r.dup_new_pct)).toEqual([2, 3, 4]);
  });

  it('returns everything when the limit exceeds the row count', () => {
    const root = makeProject();
    recordChangeMetrics(root, metrics(1, 1, 10));
    expect(readChangeMetricsRows(root, 20)).toHaveLength(1);
  });

  it('returns an empty list when nothing was recorded', () => {
    const root = makeProject();
    expect(readChangeMetricsRows(root, 20)).toEqual([]);
  });
});
