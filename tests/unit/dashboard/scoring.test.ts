import { describe, expect, it } from 'vitest';

import {
  bandForScore,
  scoreFreshness,
  scoreFreshnessAverage,
  scorePresence,
} from '@/dashboard/scoring';
import { ageInDays } from '@/dashboard/scoring/freshness';

const MS_PER_DAY = 86_400_000;
const NOW = Date.UTC(2026, 4, 26);
const at = (daysAgo: number): number => NOW - daysAgo * MS_PER_DAY;

describe('scoreFreshness', () => {
  it('returns 100 for a file modified inside the fresh window', () => {
    expect(scoreFreshness(at(0), { now: NOW })).toBe(100);
    expect(scoreFreshness(at(29), { now: NOW })).toBe(100);
    expect(scoreFreshness(at(30), { now: NOW })).toBe(100);
  });

  it('returns 0 once the stale cliff is reached', () => {
    expect(scoreFreshness(at(180), { now: NOW })).toBe(0);
    expect(scoreFreshness(at(365), { now: NOW })).toBe(0);
  });

  it('decays linearly between the fresh window and the stale cliff', () => {
    // Midpoint between 30 and 180 is 105 days → ~50.
    expect(scoreFreshness(at(105), { now: NOW })).toBe(50);
  });

  it('treats null / undefined / NaN as missing (score 0)', () => {
    expect(scoreFreshness(null, { now: NOW })).toBe(0);
    expect(scoreFreshness(undefined, { now: NOW })).toBe(0);
    expect(scoreFreshness(Number.NaN, { now: NOW })).toBe(0);
  });

  it('clamps future timestamps to 100', () => {
    expect(scoreFreshness(NOW + 10 * MS_PER_DAY, { now: NOW })).toBe(100);
  });
});

describe('scoreFreshnessAverage', () => {
  it('returns 0 when the input is empty', () => {
    expect(scoreFreshnessAverage([], { now: NOW })).toBe(0);
  });

  it('averages individual scores', () => {
    // Two fresh (100) + one fully stale (0) → ~67.
    expect(scoreFreshnessAverage([at(1), at(2), at(365)], { now: NOW })).toBe(67);
  });
});

describe('ageInDays', () => {
  it('returns floor age in days', () => {
    expect(ageInDays(at(0), NOW)).toBe(0);
    expect(ageInDays(at(4.7), NOW)).toBe(4);
  });

  it('returns null for missing input', () => {
    expect(ageInDays(null, NOW)).toBeNull();
    expect(ageInDays(undefined, NOW)).toBeNull();
  });
});

describe('scorePresence', () => {
  it('returns 0 when nothing is expected', () => {
    expect(scorePresence({ expected: 0, present: 0 })).toBe(0);
  });

  it('returns 100 when all expected artifacts are present and fresh', () => {
    expect(scorePresence({ expected: 5, present: 5, stale: 0 })).toBe(100);
    expect(scorePresence({ expected: 5, present: 5 })).toBe(100);
  });

  it('penalises missing artifacts', () => {
    expect(scorePresence({ expected: 5, present: 3 })).toBe(60);
  });

  it('blends presence and freshness when stale count is given', () => {
    // Present: 4/5 → 0.8 presence. Stale: 2 of 4 → 0.5 freshness.
    // 0.8 * 0.7 + 0.5 * 0.3 = 0.71 → 71.
    expect(scorePresence({ expected: 5, present: 4, stale: 2 })).toBe(71);
  });

  it('clamps over-presence to 100 (e.g. extra modules detected)', () => {
    expect(scorePresence({ expected: 3, present: 5 })).toBe(100);
  });
});

describe('bandForScore', () => {
  it('maps to the documented thresholds', () => {
    expect(bandForScore(100)).toBe('green');
    expect(bandForScore(80)).toBe('green');
    expect(bandForScore(79)).toBe('amber');
    expect(bandForScore(50)).toBe('amber');
    expect(bandForScore(49)).toBe('red');
    expect(bandForScore(0)).toBe('red');
  });

  it('returns unknown for null scores (N/A sections)', () => {
    expect(bandForScore(null)).toBe('unknown');
  });
});
