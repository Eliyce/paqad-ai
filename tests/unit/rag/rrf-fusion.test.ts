import { describe, expect, it } from 'vitest';

import { RRF_K, reciprocalRankFusion } from '@/rag/rrf-fusion.js';

describe('reciprocalRankFusion', () => {
  it('ranks an id agreed on by both lists above singletons', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['b', 'd', 'a'],
    ]);
    expect(fused[0].id).toBe('b');
  });

  it('lifts a lexically-strong, densely-weak id (the F17 win)', () => {
    const dense = ['fuzzy1', 'fuzzy2', 'exact'];
    const lexical = ['exact'];
    const fused = reciprocalRankFusion([dense, lexical]);
    const exactRank = fused.findIndex((r) => r.id === 'exact');
    const fuzzy2Rank = fused.findIndex((r) => r.id === 'fuzzy2');
    expect(exactRank).toBeLessThan(fuzzy2Rank);
  });

  it('preserves the single-list order when only one ranking is non-empty', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], []]);
    expect(fused.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks score ties by first appearance (deterministic)', () => {
    const fused = reciprocalRankFusion([
      ['x', 'y'],
      ['y', 'x'],
    ]);
    expect(fused.map((r) => r.id)).toEqual(['x', 'y']);
  });

  it('uses the documented default k', () => {
    expect(RRF_K).toBe(60);
    const [top] = reciprocalRankFusion([['only']]);
    expect(top.score).toBeCloseTo(1 / (RRF_K + 1));
  });
});
