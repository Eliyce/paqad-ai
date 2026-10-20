import { describe, expect, it } from 'vitest';

import { computeClassificationConfidence } from '@/pipeline/confidence-scorer.js';

describe('computeClassificationConfidence', () => {
  it('returns zero when no dimensions are resolved', () => {
    expect(computeClassificationConfidence({})).toBe(0);
  });

  it('weights deterministic, confirmed, and guessed fields differently', () => {
    expect(
      computeClassificationConfidence({
        workflow: 'deterministic',
        scope: 'llm-confirmed',
        risk: 'llm-guessed',
      }),
    ).toBe(0.14);
  });

  it('treats overrides and defaults with lower weights', () => {
    expect(
      computeClassificationConfidence({
        workflow: 'llm-overridden',
        scope: 'default',
      }),
    ).toBe(0.05);
  });

  it('caps confidence at 1.0 when all high-weight dimensions are set', () => {
    const allDeterministic = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`dim_${i}`, 'deterministic']),
    );
    expect(computeClassificationConfidence(allDeterministic)).toBe(1);
  });

  it('ignores undefined values in the map', () => {
    expect(computeClassificationConfidence({ workflow: undefined })).toBe(0);
  });
});
