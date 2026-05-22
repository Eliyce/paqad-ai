import { describe, expect, it } from 'vitest';

import { assertComplianceSummaryInvariants } from '@/compliance/compliance-checker.js';

describe('assertComplianceSummaryInvariants', () => {
  it('throws when state totals do not sum to total', () => {
    expect(() =>
      assertComplianceSummaryInvariants({
        total: 2,
        covered: 1,
        partial: 0,
        uncovered: 0,
        indeterminate: 0,
        compliance_ratio: 0.5,
      }),
    ).toThrow('state sum');
  });

  it('throws when uncovered obligations claim perfect compliance_ratio', () => {
    expect(() =>
      assertComplianceSummaryInvariants({
        total: 1,
        covered: 0,
        partial: 0,
        uncovered: 1,
        indeterminate: 0,
        compliance_ratio: 1,
      }),
    ).toThrow('uncovered obligations imply compliance_ratio < 1.0');
  });

  it('accepts a valid summary where all obligations are indeterminate (ratio 1, zero denominator guard)', () => {
    // When total === indeterminate, denominator = 0, ratio is guarded to 1.
    // uncovered = 0, so the invariant does not fire.
    expect(() =>
      assertComplianceSummaryInvariants({
        total: 3,
        covered: 0,
        partial: 0,
        uncovered: 0,
        indeterminate: 3,
        compliance_ratio: 1,
      }),
    ).not.toThrow();
  });

  it('accepts a valid mixed summary', () => {
    // 2 covered, 1 partial, 1 uncovered, 1 indeterminate → total 5
    // ratio = 2 / (5 - 1) = 0.5
    expect(() =>
      assertComplianceSummaryInvariants({
        total: 5,
        covered: 2,
        partial: 1,
        uncovered: 1,
        indeterminate: 1,
        compliance_ratio: 0.5,
      }),
    ).not.toThrow();
  });
});
