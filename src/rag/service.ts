import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { AstChunker, CHUNKER_VERSION } from '@/context/ast-chunker.js';
import { buildModuleRoleResolver, contextualizeChunkText } from '@/rag/contextual-blurb.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { createReranker } from '@/context/reranker.js';
import type { RerankingConfig } from '@/context/reranker.js';
import type { Chunk, ChunkIndex } from '@/context/types.js';
import type { EmbeddingProviderName, IntelligenceConfig } from '@/core/types/project-profile.js';
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
import { Bm25Index } from './lexical-bm25.js';
import { reorderByRankedIds } from './rerank-order.js';
import { reciprocalRankFusion } from './rrf-fusion.js';
import { crsCollectionLayout, crsCollectionPaths } from './crs-paths.js';
import { RagFileFilter } from './file-filter.js';
import { createEmbeddingProvider, localModelDir, localModelsRoot } from './providers.js';
import { assertEmbeddingProviderAvailable } from './removed-provider.js';
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
  RagScoredCandidate,
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

const VISION_MAX_CHUNK_CHARS = 2000;

const CRS_EMBED_BATCH_SIZE = 32;

const HYBRID_FUSION_POOL_MULTIPLIER = 4;

const RELIEF_SLICE_CAP = 2;

const REMOTE_API_KEY_NAMES = { openai: 'OPENAI_API_KEY' } as const;

function toRetrievalResult(
  candidates: readonly RagScoredCandidate[],
  extra: { bestScore?: number; lowConfidence: boolean },
): RagRetrievalResult {
  return {
    vector_scores: new Map(candidates.map((candidate) => [candidate.id, candidate.score])),
    chunks_retrieved: candidates.length,
    retrieved_chunk_ids: candidates.map((candidate) => candidate.id),
    retrieved_source_files: candidates.map((candidate) => candidate.source_file),
    retrieved_chunks: candidates.map((candidate) => ({
      id: candidate.id,
      source_file: candidate.source_file,
      content: candidate.content,
    })),
    best_score: extra.bestScore,
    low_confidence: extra.lowConfidence,
  };
}

const CRS_REVERT_RETENTION_MS = 24 * 60 * 60 * 1000;

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
    const chunkerMatch = meta?.chunker_version === CHUNKER_VERSION;
    const staleMetadata = Boolean(meta) && !providerModelMatch;
    const valid =
      Boolean(meta) &&
      !status.corrupt &&
      (!intelligence.rag_enabled || (providerModelMatch && chunkerMatch));

    let reason = status.reason;
    if (!reason && status.present && meta && !providerModelMatch) {
      reason = 'configured provider/model does not match stored vector metadata';
    } else if (!reason && status.present && meta && !chunkerMatch && intelligence.rag_enabled) {
      reason = 'stored index was built with a different chunker; a full rebuild is needed';
    }

    let visionChunkCount: number | undefined;
    try {
      visionChunkCount = (await this.visionVectorIndex.loadMeta(this.projectRoot))?.chunk_count;
    } catch {
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
    const { profile, intelligence } = await this.buildIndexCore(partial, onProgress);
    profile.intelligence = intelligence;
    writeProjectProfile(this.projectRoot, profile);
    syncFrameworkConfig(this.projectRoot, { intelligence });
    return this.getStatus();
  }

  async buildIndexOnly(
    partial: Partial<BuildIndexOptions['intelligence']>,
    onProgress?: BuildIndexOptions['onProgress'],
  ): Promise<RagStatus> {
    await this.buildIndexCore(partial, onProgress);
    return this.getStatus();
  }

  private async buildIndexCore(
    partial: Partial<BuildIndexOptions['intelligence']>,
    onProgress?: BuildIndexOptions['onProgress'],
  ): Promise<{
    profile: NonNullable<ReturnType<typeof readProjectProfile>>;
    intelligence: ReturnType<typeof normalizeIntelligenceConfig>;
  }> {
    const profile = readProjectProfile(this.projectRoot);
    if (!profile) {
      throw new Error('Project profile not found');
    }

    const intelligence = normalizeIntelligenceConfig({
      ...profile.intelligence,
      ...partial,
      rag_enabled: true,
    });
    assertEmbeddingProviderAvailable(this.projectRoot, intelligence.embedding_provider);

    if (intelligence.embedding_provider === undefined) {
      throw new Error('Embedding provider is required when enabling RAG');
    }

    await this.rebuild({ intelligence, onProgress });
    await this.patternVectors.refresh(this.projectRoot, (message) =>
      onProgress?.({ phase: 'build', message }),
    );
    appendRagAudit(this.projectRoot, 'INFO', 'rag-enabled', {
      provider: intelligence.embedding_provider,
      model: intelligence.embedding_model,
    });
    return { profile, intelligence };
  }

  async rebuild(options?: BuildIndexOptions): Promise<void> {
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(
      options?.intelligence ?? profile?.intelligence,
    );
    assertEmbeddingProviderAvailable(this.projectRoot, intelligence.embedding_provider);

    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      throw new Error('RAG must be enabled and configured before rebuilding');
    }

    const start = Date.now();
    const signal = options?.signal;
    const runId = randomUUID();
    let provider: EmbeddingProvider | undefined;

    try {
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
        embedTextOf: this.buildEmbedContextualizer(),
      });
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
          chunker_version: CHUNKER_VERSION,
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
      setConfigValue(this.projectRoot, 'rag_enabled', 'false');
    }
    await this.vectorIndex.clear(this.projectRoot);
    appendRagAudit(this.projectRoot, 'INFO', 'rag-cleared');
  }

  async refreshContext(): Promise<ChunkIndexSyncResult> {
    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    this.refuseRemovedProvider(intelligence);
    const sourceFiles = await this.discoverSourceFiles();
    const syncResult = await this.indexManager.sync(sourceFiles, this.chunker);
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
    syncResult: ChunkIndexSyncResult | null,
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
    this.refuseRemovedProvider(intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      return {
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
      };
    }

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
      if (!skipSync && syncResult !== null) {
        await this.syncVectorIndex(syncResult, intelligence);
      }
      const limit = topN ?? intelligence.rag_top_n;
      const scored = await this.scoreCandidates(input, limit, intelligence);
      const bestScore = scored.length > 0 ? scored[0].score : undefined;

      const aboveFloor = scored.filter(
        (candidate) => candidate.score >= intelligence.rag_similarity_threshold,
      );
      if (aboveFloor.length > 0) {
        return toRetrievalResult(aboveFloor, { bestScore, lowConfidence: false });
      }

      const relief = scored
        .filter((candidate) => candidate.score >= intelligence.rag_relief_floor)
        .slice(0, RELIEF_SLICE_CAP);
      if (relief.length > 0) {
        return toRetrievalResult(relief, { bestScore, lowConfidence: true });
      }

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
        best_score: bestScore,
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

  async retrieveForEval(
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    topN?: number,
    options: { skipSync?: boolean } = {},
  ): Promise<RagRetrievalResult> {
    const syncResult = options.skipSync === true ? null : await this.refreshContext();
    return this.retrieveWithSyncPolicy(syncResult, input, topN, true);
  }

  private async scoreCandidates(
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    limit: number,
    intelligence: IntelligenceConfig,
  ): Promise<RagScoredCandidate[]> {
    const provider = await this.providerFactory(this.projectRoot, intelligence);
    const queryText = queryTextFromTask(
      input.taskDescription,
      input.keywords,
      input.targetFilePath,
      input.symbolReferences ?? [],
    );
    const [queryVector] = await provider.embed(queryText);
    const pool = limit * HYBRID_FUSION_POOL_MULTIPLIER;
    const [fileResults, visionResults] = await Promise.all([
      this.vectorIndex.query(this.projectRoot, queryVector, pool),
      this.visionVectorIndex.query(this.projectRoot, queryVector, pool),
    ]);
    const dense = [...fileResults, ...visionResults].sort(
      (left, right) => right.score - left.score,
    );
    const fused = fuseHybridRanking(dense, queryText);
    const reranked = await this.applyReranking(queryText, fused, intelligence.reranking);
    return reranked.slice(0, limit).map((result) => ({
      id: result.item.id,
      source_file: result.item.source_file,
      content: result.item.content,
      score: result.score,
    }));
  }

  async probe(
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    topN?: number,
  ): Promise<RagScoredCandidate[]> {
    const intelligence = normalizeIntelligenceConfig(
      readProjectProfile(this.projectRoot)?.intelligence,
    );
    this.refuseRemovedProvider(intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      return [];
    }
    await this.refreshContext();
    const status = await this.getStatus();
    if (!status.index_present || !status.valid) {
      return [];
    }
    return this.scoreCandidates(input, topN ?? intelligence.rag_top_n, intelligence);
  }

  async ingestExtractedText(input: VisionIngestInput): Promise<VisionIngestResult> {
    if (!(SUPPORTED_EXTRACTION_KINDS as readonly string[]).includes(input.extractionKind)) {
      throw new RagIngestError(
        'unknown_extraction_kind',
        `Unknown extraction kind: ${String(input.extractionKind)}`,
        { extraction_kind: input.extractionKind },
      );
    }

    if (typeof input.text !== 'string' || input.text.trim().length === 0) {
      throw new RagIngestError('empty_extracted_text', 'Extracted text is empty');
    }

    if (input.text.includes('�')) {
      throw new RagIngestError('text_not_utf8', 'Extracted text is not valid UTF-8');
    }

    const extension = extname(input.sourcePath).toLowerCase();
    if (!(SUPPORTED_VISION_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new RagIngestError(
        'unsupported_file_type',
        `Unsupported file type for vision ingest: ${extension || '(none)'}`,
        { source_path: input.sourcePath },
      );
    }

    const resolvedRoot = resolve(this.projectRoot);
    const resolvedPath = resolve(this.projectRoot, input.sourcePath);
    if (!resolvedPath.startsWith(resolvedRoot + sep)) {
      throw new RagIngestError(
        'path_outside_project',
        `Source path resolves outside the project root: ${input.sourcePath}`,
        { source_path: input.sourcePath },
      );
    }

    const profile = readProjectProfile(this.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    this.refuseRemovedProvider(intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      throw new Error('RAG must be enabled and configured before ingesting extracted text');
    }

    const sourceMissing = !existsSync(resolvedPath);

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

    const provider = await this.providerFactory(this.projectRoot, intelligence);
    const vectors = await provider.embed(chunks.map((chunk) => chunk.content));
    const embedded: StoredVisionChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      extraction_kind: input.extractionKind,
      source_missing: sourceMissing,
      vector: vectors[index],
    }));

    const current = await this.visionVectorIndex.load(this.projectRoot);
    const retained = (current?.items ?? []).filter((item) => item.source_file !== input.sourcePath);
    await this.visionVectorIndex.replaceAll(this.projectRoot, [...retained, ...embedded], {
      provider: provider.name,
      model: provider.model,
    });

    appendRagAudit(this.projectRoot, 'INFO', 'rag-vision-ingested', {
      source_path: input.sourcePath,
      extraction_kind: input.extractionKind,
      chunk_count: embedded.length,
      source_missing: sourceMissing,
    });

    return {
      chunkCount: embedded.length,
      sourcePath: input.sourcePath,
      extractionKind: input.extractionKind,
    };
  }

  resolveApiKeyName(provider: 'openai'): 'OPENAI_API_KEY' {
    return REMOTE_API_KEY_NAMES[provider];
  }

  storeApiKey(provider: 'openai', value: string): string {
    return writeProjectSecret(this.projectRoot, this.resolveApiKeyName(provider), value);
  }

  hasApiKey(provider: 'openai'): boolean {
    return Boolean(getProjectSecret(this.projectRoot, this.resolveApiKeyName(provider)));
  }

  private refuseRemovedProvider(intelligence: IntelligenceConfig): void {
    if (intelligence.rag_enabled) {
      assertEmbeddingProviderAvailable(this.projectRoot, intelligence.embedding_provider);
    }
  }

  localModelPath(): string {
    return localModelsRoot();
  }

  localModelCached(model?: string): boolean {
    try {
      const path = model ? localModelDir(model) : this.localModelPath();
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  async writeChunks(
    chunks: CrsChunkInput[],
    collectionId: CrsCollectionId,
  ): Promise<CrsIndexedSessionEvent> {
    await FileVectorIndex.create(this.projectRoot, collectionId);
    const intelligence = normalizeIntelligenceConfig(
      readProjectProfile(this.projectRoot)?.intelligence,
    );
    const provider = await this.providerFactory(this.projectRoot, intelligence);

    if (this.crsBacklog.size > 0) {
      await this.crsBacklog.drain((id, queued) =>
        this.persistCrsChunks(provider, id, queued).then(() => undefined),
      );
    }

    try {
      return await this.persistCrsChunks(provider, collectionId, chunks);
    } catch (error) {
      this.crsBacklog.enqueue(chunks, collectionId);
      throw error;
    }
  }

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

  private async sweepExpiredCrsReverts(collectionId: CrsCollectionId): Promise<void> {
    const { escaped, crsRootAbs } = crsCollectionLayout(this.projectRoot, collectionId);
    let entries: string[];
    try {
      entries = await readdir(crsRootAbs);
    } catch {
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

  private async applyReranking<T extends { item: { id: string; content: string } }>(
    query: string,
    hits: readonly T[],
    config?: RerankingConfig,
  ): Promise<T[]> {
    if (!config?.enabled || hits.length <= 1) {
      return [...hits];
    }
    try {
      const reranker = createReranker(config);
      const { post_rerank_ids } = await reranker.rerank(
        query,
        hits.map((hit) => hit.item as Chunk),
        config.candidate_pool_size,
      );
      return reorderByRankedIds(hits, (hit) => hit.item.id, post_rerank_ids);
    } catch (error) {
      appendRagAudit(this.projectRoot, 'WARN', 'rag-rerank-fallback', {
        reason: error instanceof Error ? error.message : 'unknown-error',
      });
      return [...hits];
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

    const embedded = await this.embedChunks(provider, changedChunks, {
      embedTextOf: this.buildEmbedContextualizer(),
    });
    await this.vectorIndex.replaceAll(
      this.projectRoot,
      [...unchanged, ...embedded],
      {
        provider: provider.name,
        model: provider.model,
        chunker_version: CHUNKER_VERSION,
      },
      intelligence.rag_base_branch,
    );
    appendRagAudit(this.projectRoot, 'INFO', 'rag-incremental-update', {
      changed_files: [...changedSources].length,
      deleted_files: syncResult.deleted_files.length,
      chunks: unchanged.length + embedded.length,
    });
  }

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

  private buildEmbedContextualizer(): (chunk: Chunk) => string {
    const roleOf = buildModuleRoleResolver(this.projectRoot);
    return (chunk: Chunk) =>
      contextualizeChunkText(chunk, { moduleRole: roleOf(chunk.source_file) });
  }

  private async embedChunks(
    provider: EmbeddingProvider,
    chunks: Chunk[],
    options: {
      onProgress?: BuildIndexOptions['onProgress'];
      signal?: AbortSignal;
      embedTextOf: (chunk: Chunk) => string;
    },
  ): Promise<StoredVectorChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const onProgress = options.onProgress;
    const signal = options.signal;
    const embedTextOf = options.embedTextOf;

    const cache = EmbeddingCache.load(this.projectRoot, provider.model);
    const missIndices: number[] = [];
    for (let index = 0; index < chunks.length; index++) {
      if (!cache.has(embedTextOf(chunks[index]))) {
        missIndices.push(index);
      }
    }

    const assemble = (): StoredVectorChunk[] =>
      chunks
        .map((chunk) => {
          const vector = cache.get(embedTextOf(chunk));
          return vector ? { ...chunk, vector } : null;
        })
        .filter((item): item is StoredVectorChunk => item !== null);

    const cachedCount = chunks.length - missIndices.length;
    const batchSize = 32;
    const start = Date.now();
    for (let offset = 0; offset < missIndices.length; offset += batchSize) {
      if (signal?.aborted) {
        await cache.flush();
        throw new CancelledError('RAG rebuild cancelled by consumer', {
          partialChunks: assemble(),
        } as Record<string, unknown>);
      }
      const batchIndices = missIndices.slice(offset, offset + batchSize);
      const vectors = await provider.embed(batchIndices.map((index) => embedTextOf(chunks[index])));
      for (let position = 0; position < batchIndices.length; position++) {
        cache.set(embedTextOf(chunks[batchIndices[position]]), vectors[position]);
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
      } catch {}
    })();

    return this.resumeValidationPromise;
  }
}

function flattenChunks(index: ChunkIndex): Chunk[] {
  return index.entries.flatMap((entry) => entry.chunks);
}

interface DenseHit {
  item: {
    id: string;
    content: string;
    source_file?: string;
    ast_node_path?: string;
    exported_symbols?: string[];
  };
  score: number;
}

export function lexicalDocumentText(item: {
  id: string;
  content: string;
  source_file?: string;
  ast_node_path?: string;
  exported_symbols?: string[];
}): string {
  if (!item.source_file) {
    return item.content;
  }
  return contextualizeChunkText({
    source_file: item.source_file,
    ast_node_path: item.ast_node_path ?? '',
    exported_symbols: item.exported_symbols ?? [],
    content: item.content,
  });
}

function fuseHybridRanking<T extends DenseHit>(dense: readonly T[], queryText: string): T[] {
  if (dense.length <= 1) {
    return [...dense];
  }
  const lexical = new Bm25Index(
    dense.map((hit) => ({
      id: hit.item.id,
      content: lexicalDocumentText(hit.item),
    })),
  )
    .search(queryText)
    .map((hit) => hit.id);
  if (lexical.length === 0) {
    return [...dense];
  }
  const denseOrder = dense.map((hit) => hit.item.id);
  const byId = new Map(dense.map((hit) => [hit.item.id, hit]));
  const fused = reciprocalRankFusion([denseOrder, lexical]);
  return fused.map((entry) => byId.get(entry.id)).filter((hit): hit is T => hit !== undefined);
}
