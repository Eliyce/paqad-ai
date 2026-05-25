import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type {
  RagIndexMeta,
  StoredVectorItem,
  VectorIndexPayload,
  VectorQueryResult,
} from './types.js';

export class CorruptVectorIndexError extends Error {
  constructor(
    readonly kind: 'index' | 'meta',
    readonly filePath: string,
    readonly cause?: unknown,
  ) {
    super(`Corrupt vector ${kind} file at ${filePath}`);
    this.name = 'CorruptVectorIndexError';
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

export class FileVectorIndex<T extends StoredVectorItem = StoredVectorItem> {
  constructor(
    private readonly indexPath: string = PATHS.VECTOR_INDEX,
    private readonly metaPath: string = PATHS.VECTOR_META,
  ) {}

  async load(projectRoot: string): Promise<VectorIndexPayload<T> | null> {
    const path = this.resolveExistingIndexPath(projectRoot);
    if (!existsSync(path)) {
      return null;
    }

    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as VectorIndexPayload<T>;
    } catch (error) {
      throw new CorruptVectorIndexError('index', path, error);
    }
  }

  async loadMeta(projectRoot: string): Promise<RagIndexMeta | null> {
    const path = this.resolve(projectRoot, this.metaPath);
    if (!existsSync(path)) {
      return null;
    }

    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as RagIndexMeta;
    } catch (error) {
      throw new CorruptVectorIndexError('meta', path, error);
    }
  }

  async save(
    projectRoot: string,
    payload: VectorIndexPayload<T>,
    meta: RagIndexMeta,
  ): Promise<void> {
    const target = this.resolve(projectRoot, this.indexPath);
    await atomicWrite(target, JSON.stringify(payload, null, 2));
    await atomicWrite(this.resolve(projectRoot, this.metaPath), JSON.stringify(meta, null, 2));
    const legacyPath = this.resolveLegacyIndexPath(projectRoot);
    if (legacyPath !== target && existsSync(legacyPath)) {
      await rm(legacyPath, { force: true });
    }
  }

  async clear(projectRoot: string): Promise<void> {
    await rm(dirname(this.resolve(projectRoot, this.indexPath)), { recursive: true, force: true });
  }

  async query(
    projectRoot: string,
    vector: number[],
    topN: number,
  ): Promise<VectorQueryResult<T>[]> {
    const payload = await this.load(projectRoot);
    if (!payload) {
      return [];
    }

    return payload.items
      .map((item) => ({ item, score: cosineSimilarity(vector, item.vector) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topN);
  }

  async status(projectRoot: string): Promise<{
    present: boolean;
    sizeBytes: number;
    meta: RagIndexMeta | null;
    corrupt: boolean;
    reason?: string;
  }> {
    const indexPath = this.resolveExistingIndexPath(projectRoot);
    if (!existsSync(indexPath)) {
      return { present: false, sizeBytes: 0, meta: null, corrupt: false };
    }

    const info = await stat(indexPath);
    let meta: RagIndexMeta | null;
    try {
      meta = await this.loadMeta(projectRoot);
    } catch (error) {
      if (error instanceof CorruptVectorIndexError) {
        return {
          present: true,
          sizeBytes: info.size,
          meta: null,
          corrupt: true,
          reason:
            error.kind === 'meta'
              ? 'vector metadata is unreadable'
              : 'vector index payload is unreadable',
        };
      }
      throw error;
    }

    try {
      await this.load(projectRoot);
    } catch (error) {
      if (error instanceof CorruptVectorIndexError) {
        return {
          present: true,
          sizeBytes: info.size,
          meta,
          corrupt: true,
          reason:
            error.kind === 'meta'
              ? 'vector metadata is unreadable'
              : 'vector index payload is unreadable',
        };
      }
      throw error;
    }

    return {
      present: true,
      sizeBytes: info.size,
      meta,
      corrupt: meta === null,
      reason: meta === null ? 'vector metadata is missing' : undefined,
    };
  }

  async replaceAll(
    projectRoot: string,
    items: T[],
    metaInput: Omit<RagIndexMeta, 'version' | 'chunk_count' | 'built_at' | 'embedding_dimensions'>,
  ): Promise<RagIndexMeta> {
    const dimensions = items[0]?.vector.length ?? 0;
    const meta: RagIndexMeta = {
      version: 1,
      provider: metaInput.provider,
      model: metaInput.model,
      built_at: new Date().toISOString(),
      chunk_count: items.length,
      embedding_dimensions: dimensions,
    };
    const payload: VectorIndexPayload<T> = { version: 1, dimensions, items };
    await this.save(projectRoot, payload, meta);
    return meta;
  }

  private resolve(projectRoot: string, relativePath: string): string {
    return join(projectRoot, relativePath);
  }

  private resolveExistingIndexPath(projectRoot: string): string {
    const current = this.resolve(projectRoot, this.indexPath);
    if (existsSync(current)) {
      return current;
    }

    return this.resolveLegacyIndexPath(projectRoot);
  }

  private resolveLegacyIndexPath(projectRoot: string): string {
    if (!this.indexPath.endsWith('.json')) {
      return this.resolve(projectRoot, this.indexPath);
    }

    return this.resolve(projectRoot, this.indexPath.replace(/\.json$/, '.bin'));
  }
}
