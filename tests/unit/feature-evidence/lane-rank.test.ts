import { describe, expect, it } from 'vitest';

import { higherLane, laneRank } from '@/feature-evidence/lane-rank.js';

describe('laneRank', () => {
  it('orders fast < graduated < full, with null lowest', () => {
    expect(laneRank(null)).toBe(-1);
    expect(laneRank('fast')).toBe(0);
    expect(laneRank('graduated')).toBe(1);
    expect(laneRank('full')).toBe(2);
    expect(laneRank('full')).toBeGreaterThan(laneRank('graduated'));
    expect(laneRank('graduated')).toBeGreaterThan(laneRank('fast'));
    expect(laneRank('fast')).toBeGreaterThan(laneRank(null));
  });
});

describe('higherLane', () => {
  it('raises to the higher lane', () => {
    expect(higherLane('fast', 'full')).toBe('full');
    expect(higherLane('fast', 'graduated')).toBe('graduated');
    expect(higherLane(null, 'fast')).toBe('fast');
  });

  it('never lowers a recorded lane', () => {
    expect(higherLane('full', 'fast')).toBe('full');
    expect(higherLane('full', 'graduated')).toBe('full');
    expect(higherLane('graduated', 'fast')).toBe('graduated');
    expect(higherLane('fast', null)).toBe('fast');
    expect(higherLane('full', null)).toBe('full');
  });

  it('keeps the current lane on a tie', () => {
    expect(higherLane('full', 'full')).toBe('full');
    expect(higherLane(null, null)).toBeNull();
  });
});
