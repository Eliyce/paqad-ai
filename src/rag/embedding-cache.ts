/**
 * Content-addressed embedding cache (RAG buildout F8).
 *
 * A persistent `chunk_hash(text) -> embedding` store, scoped to one embedding
 * model, that makes re-embedding idempotent. Sync and rebuild consult it before
 * calling the provider, so:
 *   - an unchanged chunk is never re-embedded (no provider call, no token spend);
 *   - switching to a previously-seen branch re-embeds nothing (its chunks are
 *     already cached) — "base + delta" falls out for free;
 *   - the cache invalidates on a model change: the on-disk file records its model
 *     and a load for a different model starts empty.
 *
 * The store lives under `.paqad/vectors/` (gitignored, machine-local) and is
 * written atomically so a reader never sees a half-written cache.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';

/** Project-relative path of the cache file. `.paqad/vectors/` is gitignored. */
export const EMBEDDING_CACHE_RELPATH = '.paqad/vectors/embedding-cache.json';

const CACHE_VERSION = 1;

/** Content address for a chunk's text — the cache key. */
export function chunkHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface CacheFileShape {
  version: number;
  model: string;
  entries: Record<string, number[]>;
}

/**
 * An in-memory, model-scoped embedding cache backed by a single JSON file. Load
 * once per build/sync, `get`/`set` per chunk, then `flush` to persist.
 */
export class EmbeddingCache {
  private readonly entries = new Map<string, number[]>();
  private dirty = false;

  private constructor(
    private readonly path: string,
    readonly model: string,
  ) {}

  /**
   * Load the cache for `model` from `projectRoot`. A missing, corrupt, or
   * different-model file yields an empty cache (the model-change invalidation).
   */
  static load(projectRoot: string, model: string): EmbeddingCache {
    const path = join(projectRoot, EMBEDDING_CACHE_RELPATH);
    const cache = new EmbeddingCache(path, model);
    if (!existsSync(path)) return cache;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CacheFileShape;
      if (parsed.version === CACHE_VERSION && parsed.model === model && parsed.entries) {
        for (const [hash, vector] of Object.entries(parsed.entries)) {
          cache.entries.set(hash, vector);
        }
      }
    } catch {
      // Corrupt cache → start empty; it will be rewritten on the next flush.
    }
    return cache;
  }

  get(text: string): number[] | undefined {
    return this.entries.get(chunkHash(text));
  }

  has(text: string): boolean {
    return this.entries.has(chunkHash(text));
  }

  set(text: string, vector: number[]): void {
    this.entries.set(chunkHash(text), vector);
    this.dirty = true;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Persist the cache atomically. A no-op when nothing changed since load. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    const file: CacheFileShape = {
      version: CACHE_VERSION,
      model: this.model,
      entries: Object.fromEntries(this.entries),
    };
    await atomicWriteFile(this.path, JSON.stringify(file));
    this.dirty = false;
  }
}
