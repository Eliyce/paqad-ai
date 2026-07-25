import { describe, expect, it } from 'vitest';

import { formatChangeShapeLine } from '@/change-metrics/receipt-line.js';
import type { ChangeMetrics } from '@/change-metrics/types.js';

function metrics(partial: Partial<ChangeMetrics>): ChangeMetrics {
  return {
    dup_new_pct: 0,
    reuse_rate: 0,
    meaningful_changed_lines: 100,
    inputs: {
      flagged_lines: 0,
      reuse_calls: 0,
      duplication_report_present: true,
      index_present: true,
    },
    ...partial,
  };
}

describe('formatChangeShapeLine', () => {
  it('renders the verbatim format with both numbers', () => {
    expect(formatChangeShapeLine(metrics({ dup_new_pct: 0, reuse_rate: 4.2 }))).toBe(
      '> - 📏 change shape: 0% duplicated new code · 4.2 reuse calls /100 lines',
    );
  });

  it('renders a whole reuse rate with one decimal (6 → 6.0)', () => {
    expect(formatChangeShapeLine(metrics({ dup_new_pct: 10, reuse_rate: 6 }))).toBe(
      '> - 📏 change shape: 10% duplicated new code · 6.0 reuse calls /100 lines',
    );
  });

  it('renders n/a for any null part', () => {
    expect(formatChangeShapeLine(metrics({ dup_new_pct: null, reuse_rate: null }))).toBe(
      '> - 📏 change shape: n/a duplicated new code · n/a reuse calls /100 lines',
    );
  });
});
