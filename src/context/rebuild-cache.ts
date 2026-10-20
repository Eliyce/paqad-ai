import { createHash } from 'node:crypto';

import type {
  ConversationRebuildResult,
  DisplayMessage,
  RebuildCacheKey,
} from '../core/types/conversation.js';

export const DEFAULT_REBUILD_CACHE_MAX_SIZE = 50;

export class RebuildCache {
  private readonly entries = new Map<RebuildCacheKey, ConversationRebuildResult>();

  constructor(private readonly maxSize: number = DEFAULT_REBUILD_CACHE_MAX_SIZE) {}

  computeKey(displayMessages: DisplayMessage[], classifierOutput: object): RebuildCacheKey {
    return createHash('sha256')
      .update(JSON.stringify([displayMessages, classifierOutput]))
      .digest('hex');
  }

  get(key: RebuildCacheKey): ConversationRebuildResult | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: RebuildCacheKey, result: ConversationRebuildResult): void {
    this.entries.delete(key);
    this.entries.set(key, result);
    if (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value as RebuildCacheKey;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
