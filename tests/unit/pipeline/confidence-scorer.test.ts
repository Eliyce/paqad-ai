import { describe, expect, it } from 'vitest';

import { computeClassificationConfidence } from '@/pipeline/confidence-scorer.js';

// Confidence = sum(weights) / TOTAL_CLASSIFICATION_DIMENSIONS (15)
// Weights: deterministic=1.0, llm-confirmed=0.8, llm-overridden=0.6,
//          llm-guessed=0.3, default=0.1, unknown=0.1 (fallback)

describe('computeClassificationConfidence', () => {
  it('returns zero when no dimensions are resolved', () => {
    expect(computeClassificationConfidence({})).toBe(0);
  });

  it('weights deterministic, confirmed, and guessed fields differently', () => {
    // (1.0 + 0.8 + 0.3) / 15 = 2.1 / 15 = 0.14
    expect(
      computeClassificationConfidence({
        workflow: 'deterministic',
        scope: 'llm-confirmed',
        risk: 'llm-guessed',
      }),
    ).toBe(0.14);
  });

  it('treats overrides and defaults with lower weights', () => {
    // (0.6 + 0.1) / 15 = 0.7 / 15 ≈ 0.05
    expect(
      computeClassificationConfidence({
        workflow: 'llm-overridden',
        scope: 'default',
      }),
    ).toBe(0.05);
  });

  it('caps confidence at 1.0 when all high-weight dimensions are set', () => {
    // 15 deterministic entries: 15 * 1.0 / 15 = 1.0
    const allDeterministic = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`dim_${i}`, 'deterministic']),
    );
    expect(computeClassificationConfidence(allDeterministic)).toBe(1);
  });

  it('ignores undefined values in the map', () => {
    expect(computeClassificationConfidence({ workflow: undefined })).toBe(0);
  });
});
