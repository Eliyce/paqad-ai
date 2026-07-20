import { describe, expect, it } from 'vitest';

import { cosineSimilarity } from '@/core/math/cosine.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('scores a partial overlap between 0 and 1', () => {
    const score = cosineSimilarity([1, 1, 0], [1, 0, 0]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
    expect(score).toBeCloseTo(1 / Math.sqrt(2), 10);
  });

  it('is invariant to scaling', () => {
    expect(cosineSimilarity([2, 4, 6], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('returns 0 on a length mismatch', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for an empty vector', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 when either vector has zero magnitude', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });
});
