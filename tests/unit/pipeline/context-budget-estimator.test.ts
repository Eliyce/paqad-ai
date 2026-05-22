import { describe, expect, it } from 'vitest';

import { estimateContextBudgetHint } from '@/pipeline/context-budget-estimator.js';

describe('estimateContextBudgetHint', () => {
  it('returns deep for system-wide scope', () => {
    expect(
      estimateContextBudgetHint({
        scope: 'system-wide',
        delta_candidate: false,
        workflow: 'feature-development',
      }),
    ).toBe('deep');
  });

  it('returns deep for architecture and migration workflows', () => {
    expect(
      estimateContextBudgetHint({
        scope: 'single-module',
        delta_candidate: false,
        workflow: 'architecture-change',
      }),
    ).toBe('deep');
    expect(
      estimateContextBudgetHint({
        scope: 'single-module',
        delta_candidate: false,
        workflow: 'migration',
      }),
    ).toBe('deep');
  });

  it('returns standard for delta or multi-module work', () => {
    expect(
      estimateContextBudgetHint({
        scope: 'single-module',
        delta_candidate: true,
        workflow: 'feature-development',
      }),
    ).toBe('standard');
    expect(
      estimateContextBudgetHint({
        scope: 'multi-module',
        delta_candidate: false,
        workflow: 'feature-development',
      }),
    ).toBe('standard');
  });

  it('returns minimal otherwise', () => {
    expect(
      estimateContextBudgetHint({
        scope: 'single-file',
        delta_candidate: false,
        workflow: 'cleanup',
      }),
    ).toBe('minimal');
  });
});
