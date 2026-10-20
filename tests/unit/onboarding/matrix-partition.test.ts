import { ADAPTER_TYPES } from '@/core/types/adapter.js';

import { MATRIX_FIXTURES, MATRIX_GROUPS } from './matrix-harness.js';

describe('onboarding adapter matrix partition', () => {
  it('has the 25 fixtures in five groups of five', () => {
    expect(MATRIX_FIXTURES).toHaveLength(25);
    expect(MATRIX_GROUPS).toHaveLength(5);
    for (const group of MATRIX_GROUPS) expect(group).toHaveLength(5);
  });

  it('covers every fixture exactly once, in list order', () => {
    expect(MATRIX_GROUPS.flat()).toEqual([...MATRIX_FIXTURES]);
    expect(new Set(MATRIX_GROUPS.flat()).size).toBe(MATRIX_FIXTURES.length);
  });

  it('keeps 275 onboarding cases across the group files', () => {
    const cases = MATRIX_GROUPS.flat().length * ADAPTER_TYPES.length;
    expect(cases).toBe(MATRIX_FIXTURES.length * ADAPTER_TYPES.length);
    expect(cases).toBe(275);
  });
});
