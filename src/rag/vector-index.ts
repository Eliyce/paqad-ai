import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { crsCollectionDir, crsCollectionPaths } from './crs-paths.js';
import { readGitState } from './git-state.js';
import type {
  CrsChunk,
  CrsCollectionId,
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

const COLLECTION_LOCK_RETRIES = 50;
const COLLECTION_LOCK_DELAY_MS = 10;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` while holding a best-effort per-collection lock (a `.lock` directory).
 * Serialises destroy/reindex mutations so a concurrent operation can't tear the
 * on-disk index. Read queries deliberately do not take the lock — the atomic
 * `rename` swap means they always see a complete old or new state.
 */
async function withCollectionLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(dir, '.lock');
  await mkdir(dir, { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < COLLECTION_LOCK_RETRIES; attempt++) {
    try {
      await mkdir(lockPath);
      acquired = true;
      break;
    } catch {
      await delay(COLLECTION_LOCK_DELAY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    if (acquired) {
      await rm(lockPath, { recursive: true, force: true });
    }
  }
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
    metaInput: Omit<
      RagIndexMeta,
      | 'version'
      | 'chunk_count'
      | 'built_at'
      | 'embedding_dimensions'
      | 'branch'
      | 'base_branch'
      | 'base_commit'
      | 'head_commit'
    >,
    // RAG buildout F7/F10 — optional base branch override; auto-detects main→master
    // when omitted.
    baseBranch?: string,
  ): Promise<RagIndexMeta> {
    const dimensions = items[0]?.vector.length ?? 0;
    const meta: RagIndexMeta = {
      version: 1,
      provider: metaInput.provider,
      model: metaInput.model,
      built_at: new Date().toISOString(),
      chunk_count: items.length,
      embedding_dimensions: dimensions,
      // RAG buildout F7 — stamp the branch/commit/base this index reflects.
      // Best-effort: a non-git project leaves these undefined. F10 threads the
      // configured base branch through `baseBranch`.
      ...readGitState(projectRoot, baseBranch ? { baseBranch } : {}),
    };
    const payload: VectorIndexPayload<T> = { version: 1, dimensions, items };
    await this.save(projectRoot, payload, meta);
    return meta;
  }

  // ── Project-scoped CRS collections (PQD-415) ─────────────────────────────────

  /**
   * Idempotently create a CRS collection under `.paqad/crs/<escaped-id>/`. Writes
   * an empty index + meta only when neither file exists yet; a second call for the
   * same id is a no-op rather than an error and never overwrites existing data.
   */
  static async create(projectRoot: string, collectionId: CrsCollectionId): Promise<void> {
    const dir = crsCollectionDir(projectRoot, collectionId);
    await mkdir(dir, { recursive: true });
    const { indexPath, metaPath } = crsCollectionPaths(collectionId);
    const absIndex = join(projectRoot, indexPath);
    const absMeta = join(projectRoot, metaPath);
    if (existsSync(absIndex) || existsSync(absMeta)) {
      return;
    }
    const payload: VectorIndexPayload<CrsChunk> = { version: 1, dimensions: 0, items: [] };
    const meta: RagIndexMeta = {
      version: 1,
      provider: 'local',
      model: '',
      built_at: new Date().toISOString(),
      chunk_count: 0,
      embedding_dimensions: 0,
    };
    await atomicWrite(absIndex, JSON.stringify(payload, null, 2));
    await atomicWrite(absMeta, JSON.stringify(meta, null, 2));
  }

  /**
   * Remove chunks from a CRS collection atomically and return the count purged.
   * With `{ sourceSessionId }`, only that session's chunks are removed and the
   * filtered index is rewritten in place; without options the whole collection
   * directory is deleted. A non-existent collection or session purges nothing and
   * returns `0` rather than throwing.
   */
  static async destroy(
    projectRoot: string,
    collectionId: CrsCollectionId,
    options?: { sourceSessionId?: string },
  ): Promise<number> {
    const dir = crsCollectionDir(projectRoot, collectionId);
    if (!existsSync(dir)) {
      return 0;
    }
    const { indexPath, metaPath } = crsCollectionPaths(collectionId);
    const index = new FileVectorIndex<CrsChunk>(indexPath, metaPath);

    if (options?.sourceSessionId !== undefined) {
      const sessionId = options.sourceSessionId;
      return withCollectionLock(dir, async () => {
        const payload = await index.load(projectRoot);
        if (!payload) {
          return 0;
        }
        const kept = payload.items.filter((item) => item.source_session_id !== sessionId);
        const removed = payload.items.length - kept.length;
        if (removed > 0) {
          const meta = await index.loadMeta(projectRoot);
          await index.replaceAll(projectRoot, kept, {
            provider: meta?.provider ?? 'local',
            model: meta?.model ?? '',
          });
        }
        return removed;
      });
    }

    return withCollectionLock(dir, async () => {
      let count = 0;
      try {
        const payload = await index.load(projectRoot);
        count = payload?.items.length ?? 0;
      } catch {
        // A corrupt index still gets purged (the desktop's rebuild path); the
        // count is best-effort and reported as 0 when the payload is unreadable.
      }
      await rm(dir, { recursive: true, force: true });
      return count;
    });
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
