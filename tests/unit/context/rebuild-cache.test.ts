import { describe, expect, it } from 'vitest';

import { RebuildCache } from '@/context/rebuild-cache.js';
import type { ConversationRebuildResult, DisplayMessage } from '@/core/types/conversation.js';

function result(tag: string): ConversationRebuildResult {
  return {
    messages: [{ role: 'user', content: tag }],
    retrievedChunkIds: [],
    truncated: false,
    truncatedTurnCount: 0,
  };
}

const messages: DisplayMessage[] = [
  { id: 'a', role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00Z' },
];

describe('RebuildCache', () => {
  it('computeKey is stable for identical inputs and distinct otherwise', () => {
    const cache = new RebuildCache();
    expect(cache.computeKey(messages, { retrieval_needed: true })).toBe(
      cache.computeKey(messages, { retrieval_needed: true }),
    );
    expect(cache.computeKey(messages, { retrieval_needed: true })).not.toBe(
      cache.computeKey(messages, { retrieval_needed: false }),
    );
  });

  it('returns undefined on a miss and the stored value on a hit', () => {
    const cache = new RebuildCache();
    expect(cache.get('missing')).toBeUndefined();
    cache.set('k', result('one'));
    expect(cache.get('k')).toEqual(result('one'));
    expect(cache.size).toBe(1);
  });

  it('evicts the least-recently-used entry past the cap', () => {
    const cache = new RebuildCache(2);
    cache.set('k1', result('1'));
    cache.set('k2', result('2'));
    cache.set('k3', result('3')); // overflows the cap of 2 → evicts k1
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBeDefined();
    expect(cache.get('k3')).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it('refreshes recency on get so the oldest-used entry is evicted', () => {
    const cache = new RebuildCache(2);
    cache.set('k1', result('1'));
    cache.set('k2', result('2'));
    cache.get('k1'); // k1 becomes most-recently used; k2 is now oldest
    cache.set('k3', result('3')); // evicts k2
    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBeDefined();
    expect(cache.get('k3')).toBeDefined();
  });

  it('updating an existing key does not grow the cache', () => {
    const cache = new RebuildCache(2);
    cache.set('k', result('one'));
    cache.set('k', result('two'));
    expect(cache.size).toBe(1);
    expect(cache.get('k')).toEqual(result('two'));
  });
});
