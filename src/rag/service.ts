import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';

import { AstChunker } from '@/context/ast-chunker.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import type { Chunk, ChunkIndex } from '@/context/types.js';
import type { EmbeddingProviderName } from '@/core/types/project-profile.js';
import { engineLog } from '@/core/logger-registry.js';
import { PATHS } from '@/core/constants/paths.js';
import { CancelledError, isCancelledError } from '@/core/errors/cancelled-error.js';
import { appendRunCancelledEvent } from '@/module-decisions/events.js';
import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { setConfigValue, syncFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';
import { PatternVectorService } from '@/patterns/pattern-rag.js';
import { SessionResumeValidator } from '@/session/resume-validator.js';

import { appendRagAudit } from './audit.js';
import { CrsBacklogQueue } from './crs-backlog.js';
import { EmbeddingCache } from './embedding-cache.js';
import { crsCollectionLayout, crsCollectionPaths } from './crs-paths.js';
import { RagFileFilter } from './file-filter.js';
import { createEmbeddingProvider } from './providers.js';
import { getProjectSecret, writeProjectSecret } from './secrets.js';
import type {
  BuildIndexOptions,
  ChunkIndexSyncResult,
  CrsChunk,
  CrsChunkInput,
  CrsCollectionId,
  CrsIndexedSessionEvent,
  CrsRetrievalResult,
  EmbeddingProvider,
  ProviderFactory,
  RagRetrievalResult,
  RagStatus,
  ReindexProgressHandler,
  StoredVectorChunk,
  StoredVisionChunk,
  VisionIngestInput,
  VisionIngestResult,
} from './types.js';
import {
  isEmbeddingProviderError,
  RagIngestError,
  SUPPORTED_EXTRACTION_KINDS,
  SUPPORTED_VISION_EXTENSIONS,
} from './types.js';
import { FileVectorIndex } from './vector-index.js';

/** Max non-whitespace characters per vision chunk before it is split further. */
const VISION_MAX_CHUNK_CHARS = 2000;

/** Embedding batch size for CRS writes/reindex (PQD-415). */
const CRS_EMBED_BATCH_SIZE = 32;

/** How long a retired CRS index is kept under a `.revert.<ms>` suffix (24 hours). */
const CRS_REVERT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Project-relative location of the resumable partial index written when a
 * rebuild is cancelled mid-flight (PQD-104). Kept distinct from the full index
 * so a cancelled run never overwrites a previously-good `index.json`.
 */
const PARTIAL_VECTOR_INDEX = PATHS.VECTOR_INDEX.replace(/\.json$/, '.partial.json');
const PARTIAL_VECTOR_META = PATHS.VECTOR_META.replace(/\.json$/, '.partial.json');

function queryTextFromTask(
  taskDescription?: string,
  keywords: string[] = [],
  targetFilePath?: string,
  symbols: string[] = [],
): string {
  const parts = [taskDescription, ...keywords, targetFilePath, ...symbols].filter(Boolean);
  return parts.join('\n');
}

function estimateEtaSeconds(startMs: number, loaded: number, total: number): number {
  if (loaded <= 0 || total <= loaded) {
    return 0;
  }

  const elapsedMs = Math.max(Date.now() - startMs, 1);
  const rate = loaded / elapsedMs;
  return Math.max(Math.round((total - loaded) / rate / 1000), 0);
}

export class RagService {
  private readonly vectorIndex = new FileVectorIndex<StoredVectorChunk>();
  private readonly visionVectorIndex = new FileVectorIndex<StoredVisionChunk>(
    PATHS.VISION_VECTOR_INDEX,
    PATHS.VISION_VECTOR_META,
  );
  private readonly chunker = new AstChunker();
  private readonly indexManager: ChunkIndexManager;
  private readonly patternVectors: PatternVectorService;
  private readonly resumeValidator: SessionResumeValidator;
  private resumeValidationPromise?: Promise<void>;

  constructor(
    private readonly projectRoot: string,
    private readonly providerFactory: ProviderFactory = createEmbeddingProvider,
    /**
     * In-memory write backlog for CRS collections (PQD-415). Injectable so a
     * caller can size the cap or observe `.size`; defaults to a fresh queue at the
     * 1000-chunk cap.
     */
    private readonly crsBacklog: CrsBacklogQueue = new CrsBacklogQueue(),
  ) {
    this.indexManager = new ChunkIndexManager(projectRoot);
    this.patternVectors = new PatternVectorService(undefined, providerFactory);
    this.resumeValidator = new SessionResumeValidator(undefined, async () => this);
  }

  async getStatus(): Promise<RagStatus> {
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    const status = await this.vectorIndex.status(this.projectRoot);
    const meta = status.meta;
    const expectedModel = intelligence.embedding_provider
      ? intelligence.embedding_model
      : undefined;
    const providerModelMatch =
      meta?.provider === intelligence.embedding_provider && meta?.model === expectedModel;
    // Index is stale whenever a stored index exists but its provider/model doesn't match the
    // current configuration — regardless of whether RAG is currently enabled.
    const staleMetadata = Boolean(meta) && !providerModelMatch;
    const valid =
      Boolean(meta) && !status.corrupt && (!intelligence.rag_enabled || providerModelMatch);

    let reason = status.reason;
    if (!reason && status.present && meta && !providerModelMatch) {
      reason = 'configured provider/model does not match stored vector metadata';
    }

    let visionChunkCount: number | undefined;
    try {
      visionChunkCount = (await this.visionVectorIndex.loadMeta(this.projectRoot))?.chunk_count;
    } catch {
      // A corrupt vision meta must never break status reporting for the file index.
      visionChunkCount = undefined;
    }

    return {
      enabled: intelligence.rag_enabled,
      configured_provider: intelligence.embedding_provider,
      configured_model: intelligence.embedding_model,
      index_present: status.present,
      valid,
      stale_metadata: staleMetadata || undefined,
      built_at: meta?.built_at,
      chunk_count: meta?.chunk_count ?? 0,
      size_bytes: status.sizeBytes,
      reason: status.present && (!valid || staleMetadata) ? reason : undefined,
      vision_chunk_count: visionChunkCount,
    };
  }

  async configureAndBuild(
    partial: Partial<BuildIndexOptions['intelligence']>,
    onProgress?: BuildIndexOptions['onProgress'],
  ): Promise<RagStatus> {
    const profile = readProjectProfile(this.projectRoot);
    if (!profile) {
      throw new Error('Project profile not found');
    }

    const intelligence = normalizeIntelligenceConfig({
      ...profile.intelligence,
      ...partial,
      rag_enabled: true,
    });

    if (intelligence.embedding_provider === undefined) {
      throw new Error('Embedding provider is required when enabling RAG');
    }

    await this.rebuild({ intelligence, onProgress });
    profile.intelligence = intelligence;
    writeProjectProfile(this.projectRoot, profile);
    // RAG is a framework knob: persist it to `.paqad/.config`, not the lean profile.
    syncFrameworkConfig(this.projectRoot, { intelligence });
    await this.patternVectors.refresh(this.projectRoot, (message) =>
      onProgress?.({ phase: 'build', message }),
    );
    appendRagAudit(this.projectRoot, 'INFO', 'rag-enabled', {
      provider: intelligence.embedding_provider,
      model: intelligence.embedding_model,
    });
    return this.getStatus();
  }

  async rebuild(options?: BuildIndexOptions): Promise<void> {
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(
      options?.intelligence ?? profile?.intelligence,
    );

    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      throw new Error('RAG must be enabled and configured before rebuilding');
    }

    const start = Date.now();
    const signal = options?.signal;
    const runId = randomUUID();
    let provider: EmbeddingProvider | undefined;

    try {
      // Pre-flight: never start work once the consumer has already aborted.
      this.throwIfAborted(signal);

      provider = await this.providerFactory(this.projectRoot, intelligence, options?.onProgress);

      try {
        await provider.validate();
      } catch (error) {
        if (isEmbeddingProviderError(error) && error.code === 'invalid_api_key') {
          appendRagAudit(this.projectRoot, 'WARN', 'rag-api-key-validation-failed', {
            provider: provider.name,
            reason: error.message,
          });
        }
        throw error;
      }

      appendRagAudit(this.projectRoot, 'INFO', 'rag-build-started', {
        provider: provider.name,
        model: provider.model,
      });

      const sourceFiles = await this.discoverSourceFiles(options?.onProgress);
      options?.onProgress?.({
        phase: 'build',
        message: `Chunking ${sourceFiles.length} source files`,
        loaded: 0,
        total: sourceFiles.length,
        percent: 0,
      });
      const chunkIndex = await this.indexManager.rebuild(sourceFiles, this.chunker);
      options?.onProgress?.({
        phase: 'build',
        message: `Chunked ${chunkIndex.entries.length}/${sourceFiles.length} files`,
        loaded: chunkIndex.entries.length,
        total: sourceFiles.length,
        percent:
          sourceFiles.length === 0
            ? 100
            : Math.round((chunkIndex.entries.length / sourceFiles.length) * 100),
      });

      const items = await this.embedChunks(provider, flattenChunks(chunkIndex), {
        onProgress: options?.onProgress,
        signal,
      });
      // Final boundary: an abort landing between embedding and the index write
      // still cancels — the embedded chunks become the partial checkpoint.
      if (signal?.aborted) {
        throw new CancelledError('RAG rebuild cancelled by consumer', {
          partialChunks: items,
        } as Record<string, unknown>);
      }
      await this.vectorIndex.replaceAll(
        this.projectRoot,
        items,
        {
          provider: provider.name,
          model: provider.model,
        },
        intelligence.rag_base_branch,
      );
      await this.patternVectors.refresh(this.projectRoot, (message) =>
        options?.onProgress?.({ phase: 'build', message }),
      );
      appendRagAudit(this.projectRoot, 'INFO', 'rag-build-completed', {
        provider: provider.name,
        model: provider.model,
        chunks: items.length,
        duration_ms: Date.now() - start,
      });
    } catch (error) {
      if (isCancelledError(error)) {
        const checkpointPath = await this.writePartialIndex(error, provider);
        appendRagAudit(this.projectRoot, 'WARN', 'rag-build-cancelled', {
          checkpoint_path: checkpointPath,
          duration_ms: Date.now() - start,
        });
        appendRunCancelledEvent(this.projectRoot, runId, {
          reason: 'rag-rebuild-cancelled',
          checkpoint_path: checkpointPath,
        });
        // Re-throw with only the stable, public-facing checkpoint detail.
        throw new CancelledError('RAG rebuild cancelled by consumer', {
          checkpoint_path: checkpointPath,
        });
      }
      appendRagAudit(this.projectRoot, 'WARN', 'rag-build-failed', {
        reason: error instanceof Error ? error.message : 'unknown-error',
        duration_ms: Date.now() - start,
      });
      throw error;
    }
  }

  /**
   * Write the chunks embedded before cancellation to a resumable `.partial`
   * index and return its project-relative path (PQD-104). Returns undefined when
   * nothing was embedded (e.g. aborted before the provider was ready), in which
   * case no partial file is written.
   */
  private async writePartialIndex(
    error: CancelledError,
    provider: EmbeddingProvider | undefined,
  ): Promise<string | undefined> {
    const partial = (error.details?.partialChunks as StoredVectorChunk[] | undefined) ?? [];
    if (partial.length === 0 || !provider) {
      return undefined;
    }
    const partialIndex = new FileVectorIndex<StoredVectorChunk>(
      PARTIAL_VECTOR_INDEX,
      PARTIAL_VECTOR_META,
    );
    await partialIndex.replaceAll(this.projectRoot, partial, {
      provider: provider.name,
      model: provider.model,
    });
    return PARTIAL_VECTOR_INDEX;
  }

  async clear(): Promise<void> {
    const profile = readProjectProfile(this.projectRoot);
    if (profile) {
      profile.intelligence = {
        ...profile.intelligence,
        rag_enabled: false,
      };
      writeProjectProfile(this.projectRoot, profile);
      // Mirror the disable into `.paqad/.config` (the source of truth for RAG state).
      setConfigValue(this.projectRoot, 'rag_enabled', 'false');
    }
    await this.vectorIndex.clear(this.projectRoot);
    appendRagAudit(this.projectRoot, 'INFO', 'rag-cleared');
  }

  async refreshContext(): Promise<ChunkIndexSyncResult> {
    const sourceFiles = await this.discoverSourceFiles();
    const syncResult = await this.indexManager.sync(sourceFiles, this.chunker);
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!intelligence.rag_enabled) {
      return syncResult;
    }

    const status = await this.getStatus();
    if (!status.index_present || !status.valid || !intelligence.embedding_provider) {
      if (!status.index_present) {
        appendRagAudit(this.projectRoot, 'WARN', 'rag-fallback', {
          reason: 'missing-index-during-refresh',
        });
      } else if (!status.valid && status.reason?.includes('provider/model')) {
        appendRagAudit(this.projectRoot, 'WARN', 'rag-provider-mismatch', {
          reason: status.reason,
        });
      } else if (!status.valid) {
        appendRagAudit(this.projectRoot, 'WARN', 'rag-fallback', {
          reason: status.reason ?? 'invalid-index-during-refresh',
        });
      }
      return syncResult;
    }

    await this.syncVectorIndex(syncResult, intelligence);
    await this.patternVectors.refresh(this.projectRoot);
    return syncResult;
  }

  async retrieve(
    syncResult: ChunkIndexSyncResult,
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    topN?: number,
  ): Promise<RagRetrievalResult> {
    return this.retrieveWithSyncPolicy(syncResult, input, topN, false);
  }

  private async retrieveWithSyncPolicy(
    syncResult: ChunkIndexSyncResult,
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    topN: number | undefined,
    skipSync: boolean,
  ): Promise<RagRetrievalResult> {
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      return {
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
      };
    }

    // When topN is explicitly 0, skip vector retrieval entirely (depth = 'none')
    if (topN === 0) {
      return {
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
      };
    }

    await this.validateResumeState();

    const status = await this.getStatus();
    if (!status.index_present) {
      appendRagAudit(this.projectRoot, 'WARN', 'rag-fallback', { reason: 'missing-index' });
      return {
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
        fallback_reason: 'missing-index',
      };
    }
    if (!status.valid) {
      if (status.reason?.includes('provider/model')) {
        appendRagAudit(this.projectRoot, 'WARN', 'rag-provider-mismatch', {
          reason: status.reason,
        });
      }
      appendRagAudit(this.projectRoot, 'WARN', 'rag-fallback', {
        reason: status.reason ?? 'stale-or-mismatched-index',
      });
      return {
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
        fallback_reason: status.reason ?? 'stale-or-mismatched-index',
      };
    }

    try {
      if (!skipSync) {
        await this.syncVectorIndex(syncResult, intelligence);
      }
      const provider = await this.providerFactory(this.projectRoot, intelligence);
      const [queryVector] = await provider.embed(
        queryTextFromTask(
          input.taskDescription,
          input.keywords,
          input.targetFilePath,
          input.symbolReferences ?? [],
        ),
      );
      const limit = topN ?? intelligence.rag_top_n;
      const [fileResults, visionResults] = await Promise.all([
        this.vectorIndex.query(this.projectRoot, queryVector, limit),
        this.visionVectorIndex.query(this.projectRoot, queryVector, limit),
      ]);
      // Merge file- and vision-derived hits, re-rank by score, then apply the
      // top-N cutoff so neither source crowds the other out. Vision chunks
      // conform to the same retrieval shape; callers identify them by extension.
      const results = [...fileResults, ...visionResults]
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
      const filtered = results.filter(
        (result) => result.score >= intelligence.rag_similarity_threshold,
      );
      if (filtered.length === 0) {
        appendRagAudit(this.projectRoot, 'WARN', 'rag-fallback', {
          reason: 'below-similarity-threshold',
        });
        return {
          vector_scores: new Map(),
          chunks_retrieved: 0,
          retrieved_chunk_ids: [],
          retrieved_source_files: [],
          retrieved_chunks: [],
          fallback_reason: 'below-similarity-threshold',
        };
      }
      return {
        vector_scores: new Map(filtered.map((result) => [result.item.id, result.score])),
        chunks_retrieved: filtered.length,
        retrieved_chunk_ids: filtered.map((result) => result.item.id),
        retrieved_source_files: filtered.map((result) => result.item.source_file),
        retrieved_chunks: filtered.map((result) => ({
          id: result.item.id,
          source_file: result.item.source_file,
          content: result.item.content,
        })),
      };
    } catch (error) {
      appendRagAudit(this.projectRoot, 'WARN', 'rag-fallback', {
        reason: error instanceof Error ? error.message : 'unknown-error',
      });
      return {
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
        fallback_reason: error instanceof Error ? error.message : 'unknown-error',
      };
    }
  }

  /**
   * Run a single retrieval query for eval purposes without requiring an
   * externally-managed ChunkIndexSyncResult. Refreshes the index internally.
   */
  async retrieveForEval(
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    topN?: number,
  ): Promise<RagRetrievalResult> {
    const syncResult = await this.refreshContext();
    return this.retrieveWithSyncPolicy(syncResult, input, topN, true);
  }

  /**
   * Accept plain text a consumer extracted from an image (via OCR, captioning,
   * etc.) into the retrieval index. The engine never reads the image itself; it
   * validates the input, embeds the text, and stores it in a separate vision
   * vector index keyed to the image's `sourcePath`. Re-ingesting the same path
   * replaces its prior chunks rather than duplicating them.
   *
   * @throws {RagIngestError} with a stable `code` for each rejection case.
   */
  async ingestExtractedText(input: VisionIngestInput): Promise<VisionIngestResult> {
    // 1. Known extraction kind.
    if (!(SUPPORTED_EXTRACTION_KINDS as readonly string[]).includes(input.extractionKind)) {
      throw new RagIngestError(
        'unknown_extraction_kind',
        `Unknown extraction kind: ${String(input.extractionKind)}`,
        { extraction_kind: input.extractionKind },
      );
    }

    // 2. Non-empty text.
    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      throw new RagIngestError('empty_extracted_text', 'Extracted text is empty');
    }

    // 3. UTF-8 purity — the U+FFFD replacement character signals decode garbage.
    if (input.text.includes('�')) {
      throw new RagIngestError('text_not_utf8', 'Extracted text is not valid UTF-8');
    }

    // 4. Acceptable image extension on the source path.
    const extension = extname(input.sourcePath).toLowerCase();
    if (!(SUPPORTED_VISION_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new RagIngestError(
        'unsupported_file_type',
        `Unsupported file type for vision ingest: ${extension || '(none)'}`,
        { source_path: input.sourcePath },
      );
    }

    // 5. Source path must resolve inside the project root.
    const resolvedRoot = resolve(this.projectRoot);
    const resolvedPath = resolve(this.projectRoot, input.sourcePath);
    if (!resolvedPath.startsWith(resolvedRoot + sep)) {
      throw new RagIngestError(
        'path_outside_project',
        `Source path resolves outside the project root: ${input.sourcePath}`,
        { source_path: input.sourcePath },
      );
    }

    // RAG must be configured to embed — mirror rebuild()'s precondition.
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      throw new Error('RAG must be enabled and configured before ingesting extracted text');
    }

    // 6. Disk existence — desktop owns path lifecycle, so absence is recorded,
    //    not rejected.
    const sourceMissing = !existsSync(resolvedPath);

    // 7. Split into chunks keyed to the source path + extraction kind.
    const chunkTexts = this.splitTextIntoChunks(input.text, VISION_MAX_CHUNK_CHARS);
    const chunks: Chunk[] = chunkTexts.map((raw, index) => {
      const content = raw.trim();
      return {
        id: createHash('sha256')
          .update(`${input.sourcePath}:${input.extractionKind}:${index}`)
          .digest('hex'),
        source_file: input.sourcePath,
        ast_node_type: 'fallback',
        ast_node_path: 'vision-extracted',
        exported_symbols: [],
        content,
        char_count: content.replace(/\s/g, '').length,
        content_hash: createHash('sha256').update(content).digest('hex'),
      };
    });

    // 8. Embed with the configured provider.
    const provider = await this.providerFactory(this.projectRoot, intelligence);
    const vectors = await provider.embed(chunks.map((chunk) => chunk.content));
    const embedded: StoredVisionChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      extraction_kind: input.extractionKind,
      source_missing: sourceMissing,
      vector: vectors[index],
    }));

    // 9. Replace-not-duplicate: drop prior chunks for this path, append the new
    //    set, and rewrite atomically. Last writer wins on a same-path race.
    const current = await this.visionVectorIndex.load(this.projectRoot);
    const retained = (current?.items ?? []).filter((item) => item.source_file !== input.sourcePath);
    await this.visionVectorIndex.replaceAll(this.projectRoot, [...retained, ...embedded], {
      provider: provider.name,
      model: provider.model,
    });

    // 10. Audit.
    appendRagAudit(this.projectRoot, 'INFO', 'rag-vision-ingested', {
      source_path: input.sourcePath,
      extraction_kind: input.extractionKind,
      chunk_count: embedded.length,
      source_missing: sourceMissing,
    });

    // 11. Report.
    return {
      chunkCount: embedded.length,
      sourcePath: input.sourcePath,
      extractionKind: input.extractionKind,
    };
  }

  resolveApiKeyName(provider: 'openai' | 'voyageai'): 'OPENAI_API_KEY' | 'VOYAGE_API_KEY' {
    return provider === 'openai' ? 'OPENAI_API_KEY' : 'VOYAGE_API_KEY';
  }

  storeApiKey(provider: 'openai' | 'voyageai', value: string): string {
    return writeProjectSecret(this.projectRoot, this.resolveApiKeyName(provider), value);
  }

  hasApiKey(provider: 'openai' | 'voyageai'): boolean {
    return Boolean(getProjectSecret(this.projectRoot, this.resolveApiKeyName(provider)));
  }

  localModelPath(): string {
    return join(homedir(), '.paqad', 'models');
  }

  localModelCached(model?: string): boolean {
    try {
      const path = model ? join(this.localModelPath(), model) : this.localModelPath();
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  // ── Project-scoped CRS collections (PQD-415) ─────────────────────────────────

  /**
   * Embed and persist a session's chunks into the named CRS collection, returning
   * the audit-grade {@link CrsIndexedSessionEvent} (also appended to the audit log
   * as `crs.indexed_session`). The collection is created on demand. Every stored
   * chunk carries its `source_session_id`, `source_workspace_id`, `created_at`,
   * `project_id`, and an engine-stamped `vector_timestamp`.
   *
   * If the embedding provider is unreachable, the chunks are parked in the
   * in-memory backlog and the failure is surfaced: an {@link EmbeddingBacklogOverflow}
   * when the 1000-chunk cap is exceeded (oldest dropped), otherwise the provider
   * error. On the next successful call the parked backlog is drained first.
   */
  async writeChunks(
    chunks: CrsChunkInput[],
    collectionId: CrsCollectionId,
  ): Promise<CrsIndexedSessionEvent> {
    await FileVectorIndex.create(this.projectRoot, collectionId);
    const intelligence = normalizeIntelligenceConfig(
      readProjectProfile(this.projectRoot)?.intelligence,
    );
    const provider = await this.providerFactory(this.projectRoot, intelligence);

    // Provider is reachable — flush anything parked during an earlier outage first.
    if (this.crsBacklog.size > 0) {
      await this.crsBacklog.drain((id, queued) =>
        this.persistCrsChunks(provider, id, queued).then(() => undefined),
      );
    }

    try {
      return await this.persistCrsChunks(provider, collectionId, chunks);
    } catch (error) {
      // Provider failed mid-write: park the chunks. enqueue throws
      // EmbeddingBacklogOverflow when the cap is exceeded (oldest dropped);
      // otherwise re-surface the provider error so the desktop knows the write
      // was deferred to the backlog.
      this.crsBacklog.enqueue(chunks, collectionId);
      throw error;
    }
  }

  /**
   * Retrieve from a CRS collection by raw query string. Returns only hits at or
   * above `confidenceThreshold` (default 0.5 cosine similarity), ranked by
   * descending score, each carrying its session/workspace provenance. Propagates
   * {@link CorruptVectorIndexError} on a corrupt on-disk index so the desktop can
   * fall back to file-RAG and trigger a rebuild.
   */
  async retrieveCrs(
    query: string,
    collectionId: CrsCollectionId,
    topK: number,
    confidenceThreshold = 0.5,
  ): Promise<CrsRetrievalResult[]> {
    const intelligence = normalizeIntelligenceConfig(
      readProjectProfile(this.projectRoot)?.intelligence,
    );
    const provider = await this.providerFactory(this.projectRoot, intelligence);
    const [queryVector] = await provider.embed(query);
    const { indexPath, metaPath } = crsCollectionPaths(collectionId);
    const index = new FileVectorIndex<CrsChunk>(indexPath, metaPath);
    const results = await index.query(this.projectRoot, queryVector, topK);
    return results
      .filter((result) => result.score >= confidenceThreshold)
      .map((result) => ({
        chunk: result.item,
        sourceSessionId: result.item.source_session_id,
        sourceWorkspaceId: result.item.source_workspace_id,
        score: result.score,
      }));
  }

  /**
   * Rebuild a CRS collection against a new embedding provider/model side by side,
   * with zero downtime: the new index is built in a sibling `.rebuilding` dir,
   * progress is reported via `onProgress`, then the live and new indexes are
   * swapped atomically. The old index is retained under a `.revert.<ms>` sibling
   * for 24 hours; expired reverts are swept on the next reindex.
   */
  async reindex(
    provider: EmbeddingProviderName,
    model: string,
    collectionId: CrsCollectionId,
    onProgress?: ReindexProgressHandler,
  ): Promise<void> {
    const layout = crsCollectionLayout(this.projectRoot, collectionId);
    await this.sweepExpiredCrsReverts(collectionId);

    const live = new FileVectorIndex<CrsChunk>(layout.indexPath, layout.metaPath);
    const existing = await live.load(this.projectRoot);
    const items = existing?.items ?? [];

    const relRebuildDir = join(PATHS.CRS_DIR, `${layout.escaped}.rebuilding`);
    const absRebuildDir = join(this.projectRoot, relRebuildDir);
    await rm(absRebuildDir, { recursive: true, force: true });
    await mkdir(absRebuildDir, { recursive: true });

    const intelligence = normalizeIntelligenceConfig({
      embedding_provider: provider,
      embedding_model: model,
      rag_enabled: true,
    });
    const newProvider = await this.providerFactory(this.projectRoot, intelligence);

    const rebuilt = await this.embedCrsForReindex(newProvider, items, collectionId, onProgress);
    const rebuildIndex = new FileVectorIndex<CrsChunk>(
      join(relRebuildDir, 'index.json'),
      join(relRebuildDir, 'meta.json'),
    );
    await rebuildIndex.replaceAll(this.projectRoot, rebuilt, {
      provider: newProvider.name,
      model: newProvider.model,
    });

    // Atomic swap: retire the live index to `.revert.<ms>`, promote the rebuild.
    if (existsSync(layout.absDir)) {
      const revertDir = join(layout.crsRootAbs, `${layout.escaped}.revert.${Date.now()}`);
      await rename(layout.absDir, revertDir);
    }
    await rename(absRebuildDir, layout.absDir);

    appendRagAudit(this.projectRoot, 'INFO', 'crs-reindexed', {
      collection_id: String(collectionId),
      provider: newProvider.name,
      model: newProvider.model,
      chunks: rebuilt.length,
    });
  }

  private async persistCrsChunks(
    provider: EmbeddingProvider,
    collectionId: CrsCollectionId,
    chunks: CrsChunkInput[],
  ): Promise<CrsIndexedSessionEvent> {
    const { indexPath, metaPath } = crsCollectionPaths(collectionId);
    const index = new FileVectorIndex<CrsChunk>(indexPath, metaPath);
    const embedded = await this.embedCrsChunks(provider, chunks);
    const existing = await index.load(this.projectRoot);
    const merged = [...(existing?.items ?? []), ...embedded];
    await index.replaceAll(this.projectRoot, merged, {
      provider: provider.name,
      model: provider.model,
    });
    const event: CrsIndexedSessionEvent = {
      session_id: chunks[0]?.source_session_id ?? '',
      project_id: chunks[0]?.project_id ?? '',
      chunk_count: embedded.length,
    };
    appendRagAudit(this.projectRoot, 'INFO', 'crs.indexed_session', {
      session_id: event.session_id,
      project_id: event.project_id,
      chunk_count: event.chunk_count,
    });
    return event;
  }

  private async embedCrsChunks(
    provider: EmbeddingProvider,
    chunks: CrsChunkInput[],
  ): Promise<CrsChunk[]> {
    if (chunks.length === 0) {
      return [];
    }
    const out: CrsChunk[] = [];
    for (let offset = 0; offset < chunks.length; offset += CRS_EMBED_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + CRS_EMBED_BATCH_SIZE);
      const vectors = await provider.embed(batch.map((chunk) => chunk.content));
      const stampedAt = new Date().toISOString();
      for (let index = 0; index < batch.length; index++) {
        const chunk = batch[index];
        out.push({
          id: chunk.id,
          vector: vectors[index],
          content: chunk.content,
          source_session_id: chunk.source_session_id,
          source_workspace_id: chunk.source_workspace_id,
          created_at: chunk.created_at,
          project_id: chunk.project_id,
          vector_timestamp: stampedAt,
        });
      }
    }
    return out;
  }

  private async embedCrsForReindex(
    provider: EmbeddingProvider,
    items: CrsChunk[],
    collectionId: CrsCollectionId,
    onProgress?: ReindexProgressHandler,
  ): Promise<CrsChunk[]> {
    const total = items.length;
    const currentCollection = String(collectionId);
    if (total === 0) {
      onProgress?.({ status_percent: 100, current_collection: currentCollection, est_time: 0 });
      return [];
    }
    const out: CrsChunk[] = [];
    const start = Date.now();
    for (let offset = 0; offset < total; offset += CRS_EMBED_BATCH_SIZE) {
      const batch = items.slice(offset, offset + CRS_EMBED_BATCH_SIZE);
      const vectors = await provider.embed(batch.map((item) => item.content));
      const stampedAt = new Date().toISOString();
      for (let index = 0; index < batch.length; index++) {
        out.push({ ...batch[index], vector: vectors[index], vector_timestamp: stampedAt });
      }
      const done = Math.min(offset + batch.length, total);
      onProgress?.({
        status_percent: Math.round((done / total) * 100),
        current_collection: currentCollection,
        est_time: estimateEtaSeconds(start, done, total),
      });
    }
    return out;
  }

  /** Delete `.revert.<ms>` siblings older than the 24-hour retention window. */
  private async sweepExpiredCrsReverts(collectionId: CrsCollectionId): Promise<void> {
    const { escaped, crsRootAbs } = crsCollectionLayout(this.projectRoot, collectionId);
    let entries: string[];
    try {
      entries = await readdir(crsRootAbs);
    } catch {
      // The CRS root does not exist yet — nothing to sweep.
      return;
    }
    const prefix = `${escaped}.revert.`;
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) {
        continue;
      }
      const stampedAt = Number(entry.slice(prefix.length));
      if (!Number.isFinite(stampedAt)) {
        continue;
      }
      if (now - stampedAt > CRS_REVERT_RETENTION_MS) {
        await rm(join(crsRootAbs, entry), { recursive: true, force: true });
      }
    }
  }

  private async syncVectorIndex(
    syncResult: ChunkIndexSyncResult,
    intelligence = normalizeIntelligenceConfig(readProjectProfile(this.projectRoot)?.intelligence),
  ): Promise<void> {
    const hasChanges =
      syncResult.changed_files.length > 0 ||
      syncResult.added_files.length > 0 ||
      syncResult.deleted_files.length > 0;
    if (!hasChanges || !intelligence.embedding_provider) {
      return;
    }

    const current = await this.vectorIndex.load(this.projectRoot);
    const meta = await this.vectorIndex.loadMeta(this.projectRoot);
    if (!current || !meta) {
      return;
    }

    const provider = await this.providerFactory(this.projectRoot, intelligence);
    const changedSources = new Set([...syncResult.changed_files, ...syncResult.added_files]);
    const unchanged = current.items.filter(
      (item) =>
        !changedSources.has(item.source_file) &&
        !syncResult.deleted_files.includes(item.source_file),
    );
    const changedChunks = syncResult.index.entries
      .filter((entry) => changedSources.has(entry.source_file))
      .flatMap((entry) => entry.chunks);

    const embedded = await this.embedChunks(provider, changedChunks);
    await this.vectorIndex.replaceAll(
      this.projectRoot,
      [...unchanged, ...embedded],
      {
        provider: provider.name,
        model: provider.model,
      },
      intelligence.rag_base_branch,
    );
    appendRagAudit(this.projectRoot, 'INFO', 'rag-incremental-update', {
      changed_files: [...changedSources].length,
      deleted_files: syncResult.deleted_files.length,
      chunks: unchanged.length + embedded.length,
    });
  }

  /**
   * Split externally-supplied text into chunks bounded by non-whitespace size,
   * mirroring {@link AstChunker.fallbackSplit}'s paragraph-buffer strategy.
   * Always returns at least one chunk for non-empty input.
   */
  private splitTextIntoChunks(text: string, maxChunkChars: number): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let buffer = '';

    for (const para of paragraphs) {
      const combined = buffer ? `${buffer}\n\n${para}` : para;
      const nonWhitespace = combined.replace(/\s/g, '').length;
      if (nonWhitespace > maxChunkChars && buffer) {
        chunks.push(buffer);
        buffer = para;
      } else {
        buffer = combined;
      }
    }
    if (buffer.trim()) {
      chunks.push(buffer);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new CancelledError('RAG rebuild cancelled by consumer');
    }
  }

  private async embedChunks(
    provider: EmbeddingProvider,
    chunks: Chunk[],
    options?: { onProgress?: BuildIndexOptions['onProgress']; signal?: AbortSignal },
  ): Promise<StoredVectorChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const onProgress = options?.onProgress;
    const signal = options?.signal;

    // RAG buildout F8 — consult the content-addressed cache before embedding.
    // Only chunks whose text is not already cached for this model hit the
    // provider; unchanged chunks (and a previously-seen branch's chunks) are free.
    const cache = EmbeddingCache.load(this.projectRoot, provider.model);
    const missIndices: number[] = [];
    for (let index = 0; index < chunks.length; index++) {
      if (!cache.has(chunks[index].content)) {
        missIndices.push(index);
      }
    }

    // Assemble the stored chunks from whatever is currently cached (used for the
    // success result and for the partial-checkpoint on cancellation).
    const assemble = (): StoredVectorChunk[] =>
      chunks
        .map((chunk) => {
          const vector = cache.get(chunk.content);
          return vector ? { ...chunk, vector } : null;
        })
        .filter((item): item is StoredVectorChunk => item !== null);

    const cachedCount = chunks.length - missIndices.length;
    const batchSize = 32;
    const start = Date.now();
    for (let offset = 0; offset < missIndices.length; offset += batchSize) {
      // Per-batch cancellation boundary: persist what we have embedded so far and
      // surface it as a resumable partial checkpoint (PQD-104).
      if (signal?.aborted) {
        await cache.flush();
        throw new CancelledError('RAG rebuild cancelled by consumer', {
          partialChunks: assemble(),
        } as Record<string, unknown>);
      }
      const batchIndices = missIndices.slice(offset, offset + batchSize);
      const vectors = await provider.embed(batchIndices.map((index) => chunks[index].content));
      for (let position = 0; position < batchIndices.length; position++) {
        cache.set(chunks[batchIndices[position]].content, vectors[position]);
      }
      const embeddedMisses = Math.min(offset + batchIndices.length, missIndices.length);
      const loaded = cachedCount + embeddedMisses;
      onProgress?.({
        phase: 'build',
        message: `Embedded ${loaded}/${chunks.length} chunks with ${provider.model} (${cachedCount} cached, ETA ${estimateEtaSeconds(
          start,
          embeddedMisses,
          missIndices.length,
        )}s)`,
        loaded,
        total: chunks.length,
        percent: Math.round((loaded / chunks.length) * 100),
      });
    }

    // Everything cached up front: report a single completed tick so progress
    // consumers still see a build event.
    if (missIndices.length === 0) {
      onProgress?.({
        phase: 'build',
        message: `Embedded ${chunks.length}/${chunks.length} chunks with ${provider.model} (all cached)`,
        loaded: chunks.length,
        total: chunks.length,
        percent: 100,
      });
    }

    await cache.flush();
    return assemble();
  }

  private async discoverSourceFiles(
    onProgress?: BuildIndexOptions['onProgress'],
  ): Promise<string[]> {
    const profile = readProjectProfile(this.projectRoot);
    const frameworks = profile?.stack_profile?.frameworks ?? [];
    const packs = getPacksForFrameworks(frameworks, this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    const filter = new RagFileFilter({
      projectRoot: this.projectRoot,
      packs,
      intelligence,
    });
    return filter.discoverFiles(onProgress);
  }

  private async validateResumeState(): Promise<void> {
    if (this.resumeValidationPromise) {
      return this.resumeValidationPromise;
    }

    this.resumeValidationPromise = (async () => {
      try {
        const validation = await this.resumeValidator.validate(this.projectRoot);
        if (!validation.warning) {
          return;
        }

        appendRagAudit(this.projectRoot, 'WARN', 'rag-resume-warning', {
          provider: validation.embedding_provider ?? 'unknown',
          reason: validation.warning,
        });
        engineLog('warn', validation.warning);
      } catch {
        // Resume validation is advisory and must never block retrieval.
      }
    })();

    return this.resumeValidationPromise;
  }
}

function flattenChunks(index: ChunkIndex): Chunk[] {
  return index.entries.flatMap((entry) => entry.chunks);
}
