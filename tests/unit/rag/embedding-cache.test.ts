import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EMBEDDING_CACHE_RELPATH, EmbeddingCache, chunkHash } from '@/rag/embedding-cache.js';

describe('chunkHash', () => {
  it('is deterministic and content-addressed', () => {
    expect(chunkHash('abc')).toBe(chunkHash('abc'));
    expect(chunkHash('abc')).not.toBe(chunkHash('abd'));
  });
});

describe('EmbeddingCache', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-embcache-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stores, reports, and reads back vectors after flush', async () => {
    const cache = EmbeddingCache.load(root, 'm1');
    expect(cache.has('hello')).toBe(false);
    cache.set('hello', [1, 2, 3]);
    expect(cache.has('hello')).toBe(true);
    expect(cache.get('hello')).toEqual([1, 2, 3]);
    expect(cache.size).toBe(1);
    await cache.flush();
    expect(existsSync(join(root, EMBEDDING_CACHE_RELPATH))).toBe(true);

    const reloaded = EmbeddingCache.load(root, 'm1');
    expect(reloaded.get('hello')).toEqual([1, 2, 3]);
  });

  it('invalidates (starts empty) when loaded for a different model', async () => {
    const cache = EmbeddingCache.load(root, 'm1');
    cache.set('hello', [1, 2, 3]);
    await cache.flush();

    const otherModel = EmbeddingCache.load(root, 'm2');
    expect(otherModel.has('hello')).toBe(false);
    expect(otherModel.size).toBe(0);
  });

  it('starts empty on a corrupt cache file', () => {
    const path = join(root, EMBEDDING_CACHE_RELPATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json');
    const cache = EmbeddingCache.load(root, 'm1');
    expect(cache.size).toBe(0);
  });

  it('flush is a no-op when nothing changed since load', async () => {
    const cache = EmbeddingCache.load(root, 'm1');
    await cache.flush();
    expect(existsSync(join(root, EMBEDDING_CACHE_RELPATH))).toBe(false);
  });

  it('persists multiple entries and a re-seen key is a hit', async () => {
    const cache = EmbeddingCache.load(root, 'm1');
    cache.set('a', [1]);
    cache.set('b', [2]);
    await cache.flush();
    const reloaded = EmbeddingCache.load(root, 'm1');
    expect(reloaded.get('a')).toEqual([1]);
    expect(reloaded.get('b')).toEqual([2]);
    const onDisk = JSON.parse(readFileSync(join(root, EMBEDDING_CACHE_RELPATH), 'utf8'));
    expect(onDisk.model).toBe('m1');
    expect(Object.keys(onDisk.entries)).toHaveLength(2);
  });
});
