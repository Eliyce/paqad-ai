import { createHash } from 'node:crypto';

import type {
  ConversationRebuildResult,
  DisplayMessage,
  RebuildCacheKey,
} from '../core/types/conversation.js';

// PQD-171 Step 4 — in-memory rebuild result cache.
//
// Two consecutive turns on the same display conversation with no intervening
// mutation must serve the second from cache, skipping the classifier and budget
// passes. The key is a content hash, so any edit/branch/stop changes it. The
// cache is process-lifetime only (never persisted) and LRU-bounded so a long
// session cannot grow it without limit.

/** Default entry cap; oldest entries are evicted past this (§5 safeguard). */
export const DEFAULT_REBUILD_CACHE_MAX_SIZE = 50;

export class RebuildCache {
  private readonly entries = new Map<RebuildCacheKey, ConversationRebuildResult>();

  constructor(private readonly maxSize: number = DEFAULT_REBUILD_CACHE_MAX_SIZE) {}

  /** Hash the rebuild inputs into a stable key. Same inputs ⇒ same key. */
  computeKey(displayMessages: DisplayMessage[], classifierOutput: object): RebuildCacheKey {
    return createHash('sha256')
      .update(JSON.stringify([displayMessages, classifierOutput]))
      .digest('hex');
  }

  /** Return the cached result, refreshing its recency, or `undefined` on miss. */
  get(key: RebuildCacheKey): ConversationRebuildResult | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) {
      return undefined;
    }
    // Mark as most-recently used by reinserting at the tail.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  /** Store a result, evicting the least-recently-used entry past the cap. */
  set(key: RebuildCacheKey, result: ConversationRebuildResult): void {
    this.entries.delete(key);
    this.entries.set(key, result);
    // A single set overflows the cap by at most one, so one eviction suffices.
    if (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value as RebuildCacheKey;
      this.entries.delete(oldest);
    }
  }

  /** Current entry count; primarily for tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}
