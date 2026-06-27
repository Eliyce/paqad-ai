import { describe, expect, it } from 'vitest';

import { reorderByRankedIds } from '@/rag/rerank-order.js';

interface Hit {
  id: string;
  score: number;
}

const idOf = (hit: Hit): string => hit.id;

describe('reorderByRankedIds (F18)', () => {
  const hits: Hit[] = [
    { id: 'a', score: 0.9 },
    { id: 'b', score: 0.85 },
    { id: 'c', score: 0.8 },
  ];

  it('applies the reranked order while keeping the original objects (and scores)', () => {
    const out = reorderByRankedIds(hits, idOf, ['c', 'a', 'b']);
    expect(out.map((h) => h.id)).toEqual(['c', 'a', 'b']);
    // Scores travel with the reordered objects, untouched.
    expect(out[0]).toEqual({ id: 'c', score: 0.8 });
  });

  it('appends hits the reranker did not score, in original order (nothing dropped)', () => {
    // Reranker only scored a 2-item candidate pool.
    const out = reorderByRankedIds(hits, idOf, ['b', 'a']);
    expect(out.map((h) => h.id)).toEqual(['b', 'a', 'c']);
  });

  it('ignores unknown ids from the reranker', () => {
    const out = reorderByRankedIds(hits, idOf, ['ghost', 'a']);
    expect(out.map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op-shaped passthrough when the order matches', () => {
    const out = reorderByRankedIds(hits, idOf, ['a', 'b', 'c']);
    expect(out.map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });
});
