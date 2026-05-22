import { REVIEW_DIMENSIONS, TIER_DIMENSIONS } from '@/core/types/review';

describe('review tiers', () => {
  it('keeps the full tier exhaustive', () => {
    expect(TIER_DIMENSIONS.full).toEqual(REVIEW_DIMENSIONS);
  });

  it('keeps reduced tiers constrained', () => {
    expect(TIER_DIMENSIONS.standard).toEqual([
      'completeness',
      'security',
      'data-integrity',
      'performance',
      'test-quality',
      'rollback-safety',
    ]);
    expect(TIER_DIMENSIONS['spot-check']).toEqual(['security', 'test-quality', 'rollback-safety']);
  });
});
