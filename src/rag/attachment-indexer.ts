// PQD-174 — session-scoped ephemeral attachment indexer.
//
// Chunks and embeds the files a desktop user attaches to a non-project session
// into a collection bound 1:1 to that session's id. The collection lives under
// `.paqad/attachments/<sessionId>/` — fully disjoint from the project RAG index
// and the pattern vectors — so it can be cascade-deleted with the session and
// can never leak chunks across sessions.
//
// Two behaviours are unique to this indexer and absent from RagService:
//   - retry-with-backoff: the embedding provider is retried after the initial
//     attempt with 1 s then 2 s waits; on total exhaustion the call returns a
//     structured `attachment_indexing_degraded` signal (rather than throwing)
//     so the desktop can send the message without retrieval.
//   - cancellation: an in-flight run can be aborted (by the caller's signal or
//     by `cancel()` when its session is deleted) and its partial collection is
//     purged immediately rather than left for the boot-time orphan sweep.

import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';

import { AstChunker } from '@/context/ast-chunker.js';
import type { Chunk } from '@/context/types.js';
import { CancelledError, isCancelledError } from '@/core/errors/cancelled-error.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';

import {
  resolveCollectionDir,
  collectionVectorPaths,
  registerCollection,
} from './attachment-registry.js';
import type { AttachmentIndexingOutcome, AttachmentIndexingResult } from './attachment-types.js';
import { toEphemeralCollectionId } from './attachment-types.js';
import { appendRagAudit } from './audit.js';
import { createEmbeddingProvider } from './providers.js';
import type {
  EmbeddingProvider,
  ProviderFactory,
  ProviderProgressUpdate,
  StoredVectorChunk,
} from './types.js';
import { FileVectorIndex } from './vector-index.js';

/** Default backoff waits between embedding attempts: 1 s then 2 s (PQD-174). */
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000] as const;

const EMBED_BATCH_SIZE = 32;

type ProgressFn = (update: ProviderProgressUpdate) => void;

export class SessionAttachmentIndexer {
  private readonly chunker = new AstChunker();
  /** Sessions whose `index()` is in flight, keyed to their abort controller. */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly providerFactory: ProviderFactory = createEmbeddingProvider,
    /** Injectable so tests need not wait the real 1 s / 2 s backoff. */
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  ) {}

  /**
   * Index `filePaths` into the session's collection. Resolves to a success
   * result, or to an {@link AttachmentIndexingDegradedSignal} when the provider
   * stays unreachable through every attempt. Throws {@link CancelledError} if
   * the run is aborted mid-flight (its partial collection is purged first), and
   * {@link AttachmentPathError} for a session id that escapes the attachments
   * root.
   */
  async index(
    projectRoot: string,
    sessionId: string,
    filePaths: string[],
    intelligence: IntelligenceConfig,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<AttachmentIndexingOutcome> {
    // Validate containment up front so a traversal id never reaches the fs.
    resolveCollectionDir(projectRoot, sessionId);
    const collectionId = toEphemeralCollectionId(sessionId);
    const { indexPath, metaPath } = collectionVectorPaths(projectRoot, sessionId);

    // An internal controller aborts when the caller's signal aborts OR when
    // cancel() is called for this session. The run only ever watches this one.
    const controller = new AbortController();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', () => controller.abort(), { once: true });
    }
    this.running.set(sessionId, controller);

    const start = Date.now();
    try {
      this.throwIfAborted(controller.signal);
      const chunks = await this.chunkFiles(filePaths, controller.signal);

      const provider = await this.providerFactory(projectRoot, intelligence, onProgress);
      let items: StoredVectorChunk[];
      try {
        items = await this.embedWithRetry(provider, chunks, controller.signal, onProgress);
      } catch (error) {
        if (isCancelledError(error)) {
          throw error;
        }
        // Provider unreachable through the initial attempt plus both retries:
        // degrade gracefully. Nothing was written, so there is no collection.
        await this.purgeCollection(projectRoot, sessionId);
        const reason = error instanceof Error ? error.message : 'embedding provider unreachable';
        appendRagAudit(projectRoot, 'WARN', 'rag-attachment-index-degraded', {
          session_id: sessionId,
          reason,
          retries_exhausted: true,
        });
        return {
          kind: 'attachment_indexing_degraded',
          sessionId,
          reason,
          retriesExhausted: true,
        };
      }

      // Final boundary: an abort landing between embedding and the write still
      // cancels — no full collection is left behind.
      this.throwIfAborted(controller.signal);
      const index = new FileVectorIndex<StoredVectorChunk>(indexPath, metaPath);
      await index.replaceAll(projectRoot, items, {
        provider: provider.name,
        model: provider.model,
      });
      await registerCollection(projectRoot, sessionId, collectionId, filePaths, 'indexed');
      appendRagAudit(projectRoot, 'INFO', 'rag-attachment-index-completed', {
        session_id: sessionId,
        collection_id: collectionId,
        chunks: items.length,
        duration_ms: Date.now() - start,
      });
      const result: AttachmentIndexingResult = {
        collectionId,
        chunkCount: items.length,
        durationMs: Date.now() - start,
      };
      return result;
    } catch (error) {
      if (isCancelledError(error)) {
        await this.purgeCollection(projectRoot, sessionId);
        appendRagAudit(projectRoot, 'WARN', 'rag-attachment-index-cancelled', {
          session_id: sessionId,
        });
      }
      throw error;
    } finally {
      this.running.delete(sessionId);
    }
  }

  /**
   * Abort the in-flight indexer for a session (if any) and purge its partial
   * collection immediately. Safe to call when nothing is running — it still
   * removes any collection directory left on disk for that session.
   */
  async cancel(projectRoot: string, sessionId: string): Promise<void> {
    this.running.get(sessionId)?.abort();
    await this.purgeCollection(projectRoot, sessionId);
  }

  private async chunkFiles(filePaths: string[], signal: AbortSignal): Promise<Chunk[]> {
    const chunks: Chunk[] = [];
    for (const filePath of filePaths) {
      this.throwIfAborted(signal);
      if (!existsSync(filePath)) {
        continue;
      }
      let content: string;
      try {
        content = await readFile(filePath, 'utf8');
      } catch {
        // A file the caller listed but we cannot read is skipped, not fatal —
        // the desktop owns the attachment lifecycle.
        continue;
      }
      chunks.push(...this.chunker.chunk(filePath, content));
    }
    return chunks;
  }

  private async embedWithRetry(
    provider: EmbeddingProvider,
    chunks: Chunk[],
    signal: AbortSignal,
    onProgress?: ProgressFn,
  ): Promise<StoredVectorChunk[]> {
    if (chunks.length === 0) {
      return [];
    }
    const results: StoredVectorChunk[] = [];
    for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH_SIZE) {
      this.throwIfAborted(signal);
      const batch = chunks.slice(offset, offset + EMBED_BATCH_SIZE);
      const vectors = await this.embedBatchWithRetry(
        provider,
        batch.map((chunk) => chunk.content),
        signal,
        onProgress,
      );
      for (let index = 0; index < batch.length; index++) {
        results.push({ ...batch[index], vector: vectors[index] });
      }
    }
    return results;
  }

  private async embedBatchWithRetry(
    provider: EmbeddingProvider,
    texts: string[],
    signal: AbortSignal,
    onProgress?: ProgressFn,
  ): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      this.throwIfAborted(signal);
      try {
        return await provider.embed(texts);
      } catch (error) {
        lastError = error;
        if (attempt === this.retryDelaysMs.length) {
          break;
        }
        const delayMs = this.retryDelaysMs[attempt];
        onProgress?.({
          phase: 'build',
          message: `Attachment embedding failed; retrying in ${delayMs}ms`,
        });
        await this.sleep(delayMs, signal);
      }
    }
    throw lastError ?? new Error('attachment embedding failed');
  }

  private async purgeCollection(projectRoot: string, sessionId: string): Promise<void> {
    let dir: string;
    try {
      dir = resolveCollectionDir(projectRoot, sessionId);
    } catch {
      // A traversal id never produced a contained directory — nothing to purge.
      return;
    }
    await rm(dir, { recursive: true, force: true });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new CancelledError('Attachment indexing cancelled by consumer');
    }
  }

  /** Wait `ms`, rejecting with {@link CancelledError} if `signal` aborts first. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new CancelledError('Attachment indexing cancelled by consumer'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new CancelledError('Attachment indexing cancelled by consumer'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
