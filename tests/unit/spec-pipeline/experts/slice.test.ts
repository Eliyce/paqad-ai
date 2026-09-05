import { describe, expect, it } from 'vitest';

import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import { ceilingWarning, planExpertSlices } from '@/spec-pipeline/experts/slice.js';

describe('planExpertSlices', () => {
  it('grants each expert its full budget when the sum fits the ceiling (INV-4)', () => {
    const plan = planExpertSlices(['db-expert', 'ux-ui-analyst'], 100000);
    expect(plan.warnings).toEqual([]);
    expect(plan.slices).toEqual([
      {
        role: 'db-expert',
        budget: ROLE_TOKEN_BUDGETS['db-expert'],
        granted: ROLE_TOKEN_BUDGETS['db-expert'],
        clamped: false,
      },
      {
        role: 'ux-ui-analyst',
        budget: ROLE_TOKEN_BUDGETS['ux-ui-analyst'],
        granted: ROLE_TOKEN_BUDGETS['ux-ui-analyst'],
        clamped: false,
      },
    ]);
  });

  it('keeps every expert but scales slices when the ceiling is too small (AC-6 / INV-5)', () => {
    const roles = ['db-expert', 'security-auditor', 'ux-ui-analyst'] as const;
    const ceiling = 1000;
    const plan = planExpertSlices(roles, ceiling);
    // No expert dropped.
    expect(plan.slices.map((s) => s.role)).toEqual([...roles]);
    // A warning is recorded, never a drop.
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/none dropped/);
    // Every slice is clamped below its budget and the granted total fits the ceiling.
    for (const slice of plan.slices) {
      expect(slice.clamped).toBe(true);
      expect(slice.granted).toBeLessThan(slice.budget);
    }
    const granted = plan.slices.reduce((t, s) => t + s.granted, 0);
    expect(granted).toBeLessThanOrEqual(ceiling);
  });

  it('grants at least 1 token per kept expert even under a tiny ceiling', () => {
    const plan = planExpertSlices(['db-expert', 'security-auditor'], 1);
    expect(plan.slices.every((s) => s.granted >= 1)).toBe(true);
    expect(plan.slices).toHaveLength(2);
  });

  it('is empty and warning-free for zero experts (AC-4)', () => {
    expect(planExpertSlices([], 20000)).toEqual({ slices: [], warnings: [] });
  });
});

describe('ceilingWarning', () => {
  it('names the sum, ceiling, and count and singularises one expert', () => {
    expect(ceilingWarning(50000, 20000, 1)).toMatch(/1 expert /);
    expect(ceilingWarning(50000, 20000, 3)).toMatch(/3 experts /);
  });
});
