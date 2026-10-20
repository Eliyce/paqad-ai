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

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000] as const;

const EMBED_BATCH_SIZE = 32;

type ProgressFn = (update: ProviderProgressUpdate) => void;

export class SessionAttachmentIndexer {
  private readonly chunker = new AstChunker();
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly providerFactory: ProviderFactory = createEmbeddingProvider,
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  ) {}

  async index(
    projectRoot: string,
    sessionId: string,
    filePaths: string[],
    intelligence: IntelligenceConfig,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<AttachmentIndexingOutcome> {
    resolveCollectionDir(projectRoot, sessionId);
    const collectionId = toEphemeralCollectionId(sessionId);
    const { indexPath, metaPath } = collectionVectorPaths(projectRoot, sessionId);

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
      return;
    }
    await rm(dir, { recursive: true, force: true });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new CancelledError('Attachment indexing cancelled by consumer');
    }
  }

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

export type AttachmentSessionKind = 'project' | 'ephemeral';

export const ATTACHMENT_RETRY_BUDGET_MS = 30_000;

const ATTACHMENT_RETRY_DELAY_MS = 1000;

export interface AttachmentStoredChunk extends StoredVectorChunk {
  file_content_hash: string;
}

export interface IndexAttachmentParams {
  filePath: string;
  sessionId: string;
  sessionKind: AttachmentSessionKind;
  intelligence: IntelligenceConfig;
  onProgress?: (update: ProviderProgressUpdate) => void;
  onEvent?: AttachmentEventSink;
  signal?: AbortSignal;
  parse?: ParseAttachmentOptions;
  providerFactory?: ProviderFactory;
  retryBudgetMs?: number;
  retryDelayMs?: number;
}

export interface IndexAttachmentResult {
  ok: true;
  chunkCount: number;
  provider: string;
  collectionScope: AttachmentCollectionScope;
  deduped: boolean;
}

export interface IndexAttachmentFailure {
  ok: false;
  outcome: 'index_failed' | 'format_rejected';
  reason: string;
}

export type IndexAttachmentOutcome = IndexAttachmentResult | IndexAttachmentFailure;

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
    return new FileVectorIndex<AttachmentStoredChunk>();
  }
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

  const chunks = new AstChunker().chunk(params.filePath, parsed.content);

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
