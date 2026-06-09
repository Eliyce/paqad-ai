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

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { basename } from 'node:path';

import { AstChunker } from '@/context/ast-chunker.js';
import type { Chunk } from '@/context/types.js';
import { CancelledError, isCancelledError } from '@/core/errors/cancelled-error.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';

import type {
  AttachmentCollectionScope,
  AttachmentEvent,
  AttachmentEventInput,
  AttachmentEventSink,
} from './attachment-events.js';
import { appendAttachmentEvent } from './attachment-events.js';
import {
  resolveCollectionDir,
  collectionVectorPaths,
  deregisterCollection,
  registerCollection,
} from './attachment-registry.js';
import type { ParseAttachmentOptions } from './attachment-parser.js';
import { parseAttachment } from './attachment-parser.js';
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
import { EmbeddingProviderError } from './types.js';
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

// ── PQD-331 — single-file attachment indexing (project or session) ─────────────
//
// A functional entry point distinct from {@link SessionAttachmentIndexer} (which
// PQD-174 built for bulk ephemeral session indexing). This is the contract the
// desktop IPC handler wraps: chunk + embed one attached file into either the
// persistent project collection or a session-scoped ephemeral one, emit a
// structured `attachment.*` event for the outcome, dedupe an identical re-index,
// and bound remote-provider rate-limit retries by a wall-clock budget.

/** Whether the attachment targets the project index or a session collection. */
export type AttachmentSessionKind = 'project' | 'ephemeral';

/** Default wall-clock budget for retrying a rate-limited remote embed (spec: 30 s). */
export const ATTACHMENT_RETRY_BUDGET_MS = 30_000;

/** Default wait between rate-limit retries inside the budget window. */
const ATTACHMENT_RETRY_DELAY_MS = 1000;

/** A stored attachment chunk, tagged with the source file's content hash for dedupe. */
export interface AttachmentStoredChunk extends StoredVectorChunk {
  /** SHA-256 of the parsed file content; identical content is a no-op re-index. */
  file_content_hash: string;
}

export interface IndexAttachmentParams {
  /** On-disk path of the attached file. */
  filePath: string;
  /** The owning session's id (also the ephemeral collection key). */
  sessionId: string;
  /** `project` → persistent project index; `ephemeral` → session-scoped collection. */
  sessionKind: AttachmentSessionKind;
  /** Workspace embedding configuration used to pick the provider. */
  intelligence: IntelligenceConfig;
  onProgress?: (update: ProviderProgressUpdate) => void;
  /** Live sink for the emitted attachment event (in addition to the JSONL log). */
  onEvent?: AttachmentEventSink;
  signal?: AbortSignal;
  /** Injected PDF/archive extractors and parse limits for {@link parseAttachment}. */
  parse?: ParseAttachmentOptions;
  /** Override the embedding provider factory (tests, custom providers). */
  providerFactory?: ProviderFactory;
  /** Wall-clock budget for rate-limit retries (defaults to {@link ATTACHMENT_RETRY_BUDGET_MS}). */
  retryBudgetMs?: number;
  /** Wait between rate-limit retries; injectable so tests need not really wait. */
  retryDelayMs?: number;
}

/** Successful index (or deduped no-op) outcome. */
export interface IndexAttachmentResult {
  ok: true;
  chunkCount: number;
  provider: string;
  collectionScope: AttachmentCollectionScope;
  /** True when an identical file was already indexed and embedding was skipped. */
  deduped: boolean;
}

/** A failed index: parse rejection, format rejection, or embedding failure. */
export interface IndexAttachmentFailure {
  ok: false;
  /** `format_rejected` for shape rejections; `index_failed` otherwise. */
  outcome: 'index_failed' | 'format_rejected';
  reason: string;
}

export type IndexAttachmentOutcome = IndexAttachmentResult | IndexAttachmentFailure;

/** Narrowing guard for the failure outcome. */
export function isIndexAttachmentFailure(
  outcome: IndexAttachmentOutcome,
): outcome is IndexAttachmentFailure {
  return outcome.ok === false;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function scopeOf(kind: AttachmentSessionKind): AttachmentCollectionScope {
  return kind === 'project' ? 'project' : 'session';
}

function resolveTargetIndex(
  projectRoot: string,
  params: IndexAttachmentParams,
): FileVectorIndex<AttachmentStoredChunk> {
  if (params.sessionKind === 'project') {
    // Default paths → the persistent project collection (.paqad/vectors/).
    return new FileVectorIndex<AttachmentStoredChunk>();
  }
  // Reuse PQD-174's validated session collection layout (.paqad/attachments/<id>/).
  const { indexPath, metaPath } = collectionVectorPaths(projectRoot, params.sessionId);
  return new FileVectorIndex<AttachmentStoredChunk>(indexPath, metaPath);
}

function isRateLimited(error: unknown): boolean {
  return error instanceof EmbeddingProviderError && error.code === 'rate_limited';
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError('Attachment indexing cancelled by consumer'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new CancelledError('Attachment indexing cancelled by consumer'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Embed `texts` once, retrying only rate-limit errors until the wall-clock
 * `deadline` passes. Non-rate-limit errors fail immediately; an aborted signal
 * throws {@link CancelledError}.
 */
async function embedWithinDeadline(
  provider: EmbeddingProvider,
  texts: string[],
  deadline: number,
  delayMs: number,
  signal: AbortSignal | undefined,
  onProgress?: (update: ProviderProgressUpdate) => void,
): Promise<number[][]> {
  let lastError: unknown;
  for (;;) {
    if (signal?.aborted) {
      throw new CancelledError('Attachment indexing cancelled by consumer');
    }
    try {
      return await provider.embed(texts);
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error)) {
        throw error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      onProgress?.({
        phase: 'build',
        message: `Attachment embedding rate-limited; retrying within the ${Math.max(0, Math.round(remaining))}ms budget`,
      });
      await sleepFor(Math.min(delayMs, remaining), signal);
    }
  }
  throw lastError ?? new Error('attachment embedding rate-limited beyond retry budget');
}

/**
 * Chunk, embed, and write one attached file into the project index (when
 * `sessionKind` is `project`) or a session-scoped ephemeral collection (when
 * `ephemeral`), emitting exactly one `attachment.*` event for the outcome.
 *
 * - An unparseable/encrypted/oversized/zip-bomb file writes no chunks and
 *   returns a typed failure with `attachment.index_failed` or
 *   `attachment.format_rejected` (never throws for a bad file).
 * - Re-indexing identical content for the same path is a no-op: the existing
 *   chunk count is returned and the provider is never called again.
 * - A rate-limited remote provider is retried within `retryBudgetMs` before the
 *   call fails with `attachment.index_failed`.
 *
 * Throws {@link CancelledError} only when `signal` aborts mid-flight, and the
 * registry's path guard error for a traversal `sessionId` on the ephemeral path.
 */
export async function indexAttachment(
  projectRoot: string,
  params: IndexAttachmentParams,
): Promise<IndexAttachmentOutcome> {
  const fileName = basename(params.filePath);
  const scope = scopeOf(params.sessionKind);
  const sessionField = params.sessionKind === 'ephemeral' ? params.sessionId : undefined;

  const emit = (
    event: Omit<AttachmentEventInput, 'file_name' | 'collection_scope'>,
  ): AttachmentEvent => {
    const record = appendAttachmentEvent(projectRoot, {
      ...event,
      file_name: fileName,
      collection_scope: scope,
      session_id: sessionField,
    });
    params.onEvent?.(record);
    return record;
  };

  // 1. Parse + format guards (validates the ephemeral path id up front too).
  const index = resolveTargetIndex(projectRoot, params);
  const parsed = await parseAttachment(params.filePath, params.parse);
  if (!parsed.ok) {
    emit({
      kind:
        parsed.outcome === 'format_rejected'
          ? 'attachment.format_rejected'
          : 'attachment.index_failed',
      reason: parsed.reason,
    });
    return { ok: false, outcome: parsed.outcome, reason: parsed.reason };
  }

  // 2. Same-file dedupe: identical content for this path is a no-op.
  const fileHash = sha256(parsed.content);
  const existing = await index.load(projectRoot);
  const existingItems = existing?.items ?? [];
  const alreadyIndexed = existingItems.some(
    (item) => item.source_file === params.filePath && item.file_content_hash === fileHash,
  );
  if (alreadyIndexed) {
    const meta = await index.loadMeta(projectRoot);
    const chunkCount = existingItems.filter((item) => item.source_file === params.filePath).length;
    return {
      ok: true,
      chunkCount,
      provider: meta?.provider ?? params.intelligence.embedding_provider ?? 'local',
      collectionScope: scope,
      deduped: true,
    };
  }

  // 3. Chunk the extracted text.
  const chunks = new AstChunker().chunk(params.filePath, parsed.content);

  // 4. Embed with a wall-clock rate-limit retry budget.
  const factory = params.providerFactory ?? createEmbeddingProvider;
  const provider = await factory(projectRoot, params.intelligence, params.onProgress);
  const deadline = Date.now() + (params.retryBudgetMs ?? ATTACHMENT_RETRY_BUDGET_MS);
  const delayMs = params.retryDelayMs ?? ATTACHMENT_RETRY_DELAY_MS;

  const fresh: AttachmentStoredChunk[] = [];
  try {
    for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH_SIZE) {
      if (params.signal?.aborted) {
        throw new CancelledError('Attachment indexing cancelled by consumer');
      }
      const batch = chunks.slice(offset, offset + EMBED_BATCH_SIZE);
      const vectors = await embedWithinDeadline(
        provider,
        batch.map((chunk) => chunk.content),
        deadline,
        delayMs,
        params.signal,
        params.onProgress,
      );
      for (let i = 0; i < batch.length; i++) {
        fresh.push({ ...batch[i], vector: vectors[i], file_content_hash: fileHash });
      }
    }
  } catch (error) {
    if (isCancelledError(error)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : 'embedding failed';
    appendRagAudit(projectRoot, 'WARN', 'rag-attachment-index-failed', {
      session_id: params.sessionId,
      file: fileName,
      reason,
    });
    emit({ kind: 'attachment.index_failed', reason });
    return { ok: false, outcome: 'index_failed', reason };
  }

  // 5. Merge (replacing any prior chunks for this file) and persist.
  const merged: AttachmentStoredChunk[] = [
    ...existingItems.filter((item) => item.source_file !== params.filePath),
    ...fresh,
  ];
  await index.replaceAll(projectRoot, merged, { provider: provider.name, model: provider.model });
  if (params.sessionKind === 'ephemeral') {
    await registerCollection(
      projectRoot,
      params.sessionId,
      toEphemeralCollectionId(params.sessionId),
      [params.filePath],
      'indexed',
    );
  }

  emit({ kind: 'attachment.indexed', chunk_count: fresh.length, provider: provider.name });
  return {
    ok: true,
    chunkCount: fresh.length,
    provider: provider.name,
    collectionScope: scope,
    deduped: false,
  };
}

/**
 * Remove a session's ephemeral attachment collection from disk and the registry.
 * Session-end callers invoke this to reclaim space. A no-op for an unknown or
 * traversal-unsafe session id.
 */
export async function clearEphemeralCollection(
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  let dir: string;
  try {
    dir = resolveCollectionDir(projectRoot, sessionId);
  } catch {
    return;
  }
  await rm(dir, { recursive: true, force: true });
  await deregisterCollection(projectRoot, sessionId);
}
