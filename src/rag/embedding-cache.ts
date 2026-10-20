import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';

export const EMBEDDING_CACHE_RELPATH = '.paqad/vectors/embedding-cache.json';

const CACHE_VERSION = 1;

export function chunkHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface CacheFileShape {
  version: number;
  model: string;
  entries: Record<string, number[]>;
}

export class EmbeddingCache {
  private readonly entries = new Map<string, number[]>();
  private dirty = false;

  private constructor(
    private readonly path: string,
    readonly model: string,
  ) {}

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
    } catch {}
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
