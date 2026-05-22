import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { readProjectProfile } from '@/core/project-profile.js';
import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';
import type { LoadStats, SemanticLoadOptions, Chunk, ActionRecommendation } from './types.js';
import { AstChunker } from './ast-chunker.js';
import { ChunkIndexManager } from './chunk-index.js';
import { RelevanceScorer } from './relevance-scorer.js';
import { BudgetAllocator } from './budget-allocator.js';
import { RagService } from '@/rag/service.js';
import { selectRetrievalDepth, escalateDepth, topNForDepth } from './retrieval-depth-router.js';
import type { DepthRoutingInput } from './retrieval-depth-router.js';
import { createReranker } from './reranker.js';
import type { Reranker } from './reranker.js';
import type { MetadataFilter } from './metadata-filter.js';
import { ActionRouter } from './action-router.js';
import { WorkflowTemplateLoader } from '@/workflows/template-loader.js';
import { PriorityClassifier, type ContextPriorityTier } from './priority-classifier.js';

export interface SemanticLoaderOptions {
  projectRoot: string;
  fullContextOverride?: boolean;
  sessionId: string;
}

// Minimal resolved artifact interface
interface ResolvedArtifact {
  path: string;
  content?: string;
  type?: string;
}

export class SemanticLoader {
  private readonly chunker: AstChunker;
  private readonly indexManager: ChunkIndexManager;
  private readonly scorer: RelevanceScorer;
  private readonly allocator: BudgetAllocator;
  private readonly rag: RagService;
  private readonly supportedExtensions: Set<string>;
  private readonly priorityClassifier: PriorityClassifier;
  private reranker?: Reranker;

  constructor(private readonly options: SemanticLoaderOptions) {
    this.chunker = new AstChunker();
    this.indexManager = new ChunkIndexManager(options.projectRoot);
    this.scorer = new RelevanceScorer();
    this.allocator = new BudgetAllocator();
    this.rag = new RagService(options.projectRoot);
    this.supportedExtensions = loadSupportedExtensions(options.projectRoot);
    this.priorityClassifier = new PriorityClassifier();
  }

  async load(
    artifacts: ResolvedArtifact[],
    loadOptions: SemanticLoadOptions,
  ): Promise<{
    chunks: Chunk[];
    stats: LoadStats;
    action_recommendations?: ActionRecommendation[];
  }> {
    const sourcePaths = artifacts.map((a) => a.path).filter((p) => this.isSupportedFile(p));

    // Calculate tokens_before (full-file load estimate)
    let tokensBefore = 0;
    for (const artifact of artifacts) {
      if (artifact.content) {
        tokensBefore += Math.ceil(artifact.content.length / 4);
      }
    }

    // Full-context override bypasses semantic loading
    if (loadOptions.fullContextOverride) {
      const overrideChunks = artifacts.map((a) => this.artifactToChunk(a));
      const tokensAfter = overrideChunks.reduce(
        (sum, c) => sum + Math.ceil(c.content.length / 4),
        0,
      );
      const stats: LoadStats = {
        session_id: this.options.sessionId,
        timestamp: new Date().toISOString(),
        tokens_before: tokensBefore,
        tokens_after: tokensAfter,
        reduction_pct:
          tokensBefore > 0 ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100) : 0,
        chunks_loaded: overrideChunks.length,
      };
      await this.persistStats(stats);
      return {
        chunks: overrideChunks,
        stats,
        action_recommendations: undefined,
      };
    }

    // Load or rebuild chunk index
    const sync = await this.indexManager.sync(sourcePaths, this.chunker);
    const index = sync.index;
    const allChunks = index.entries.flatMap((entry) => {
      const modifiedAtMs = Date.parse(entry.modified_at);
      return entry.chunks.map((chunk) => ({
        ...chunk,
        modified_at_ms: Number.isFinite(modifiedAtMs) ? modifiedAtMs : undefined,
      }));
    });

    // Load profile and build reranker lazily (once per loader instance)
    const profile = readProjectProfile(this.options.projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!this.reranker) {
      this.reranker = createReranker(intelligence.reranking);
    }
    const adaptiveConfig = intelligence.adaptive_retrieval!;
    const adaptiveEnabled = adaptiveConfig.enabled;
    const minUsefulChunks = adaptiveConfig.thresholds!.min_useful_chunks;

    const depthInput: DepthRoutingInput = {
      complexity: loadOptions.classification?.complexity,
      risk: loadOptions.classification?.risk,
      scope: loadOptions.classification?.scope,
      workflow: (loadOptions.classification?.workflow ?? null) as DepthRoutingInput['workflow'],
    };
    let depth = adaptiveEnabled ? selectRetrievalDepth(depthInput) : 'standard';

    const retrievalInput = {
      taskDescription: loadOptions.taskDescription,
      keywords: loadOptions.taskKeywords,
      targetFilePath: loadOptions.taskTargetFile,
      symbolReferences: loadOptions.symbolReferences,
    };

    // Extract metadata filters from request/classification/profile signals
    const metadataFiltersEnabled = intelligence.metadata_filters!.enabled;
    const metadataFilters: MetadataFilter[] = [];
    if (metadataFiltersEnabled) {
      const classification = loadOptions.classification;
      const targetExt = classification?.file_extension ?? extname(loadOptions.taskTargetFile ?? '');
      if (targetExt) {
        metadataFilters.push({ type: 'file_extension', value: targetExt });
      }

      for (const mod of classification?.affected_modules ?? []) {
        metadataFilters.push({ type: 'module_path_prefix', value: mod });
      }

      for (const framework of classification?.frameworks ??
        profile?.stack_profile?.frameworks ??
        []) {
        metadataFilters.push({ type: 'framework', value: framework });
      }

      if (classification?.recency_cutoff_ms !== undefined) {
        metadataFilters.push({
          type: 'recency_cutoff_ms',
          value: classification.recency_cutoff_ms,
        });
      }
    }

    // First-stage retrieval
    let ragResult = await this.rag.retrieve(
      sync,
      retrievalInput,
      topNForDepth(depth, intelligence.rag_top_n),
    );
    let scoringCtx = {
      keywords: loadOptions.taskKeywords,
      targetFilePath: loadOptions.taskTargetFile,
      symbolReferences: loadOptions.symbolReferences,
      sessionStartMs: Date.now(),
      vectorScores: ragResult.vector_scores,
    };
    // Bound the scoring corpus to RAG-retrieved chunks when RAG has results.
    // For depth 'none' or when RAG returns nothing, fall back to full corpus (lexical path).
    const ragBoundedCorpus = new Set(ragResult.retrieved_chunk_ids);
    const corpus =
      intelligence.rag_enabled && ragBoundedCorpus.size > 0
        ? allChunks.filter((chunk) => ragBoundedCorpus.has(chunk.id))
        : allChunks;
    let scorerResult = this.scorer.filterAndRank(corpus, scoringCtx, metadataFilters);
    let ranked = scorerResult.chunks;

    // Escalation: if RAG is enabled and too few usable chunks returned and not already at deep
    let escalated = false;
    if (
      adaptiveEnabled &&
      intelligence.rag_enabled &&
      ranked.length < minUsefulChunks &&
      depth !== 'deep'
    ) {
      depth = escalateDepth(depth);
      ragResult = await this.rag.retrieve(
        sync,
        retrievalInput,
        topNForDepth(depth, intelligence.rag_top_n),
      );
      scoringCtx = { ...scoringCtx, vectorScores: ragResult.vector_scores };
      const escalatedIds = new Set(ragResult.retrieved_chunk_ids);
      const escalatedCorpus =
        intelligence.rag_enabled && escalatedIds.size > 0
          ? allChunks.filter((chunk) => escalatedIds.has(chunk.id))
          : allChunks;
      scorerResult = this.scorer.filterAndRank(escalatedCorpus, scoringCtx, metadataFilters);
      ranked = scorerResult.chunks;
      escalated = true;
    }

    // Reranking: bounded candidate pool → reranked order
    const rerankingCfg = intelligence.reranking!;
    const candidatePoolSize = rerankingCfg.candidate_pool_size!;
    const rerankResult = await this.reranker!.rerank(
      loadOptions.taskDescription ?? loadOptions.taskKeywords.join(' '),
      ranked,
      candidatePoolSize,
    );
    const reranked = rerankResult.chunks;

    // Allocate budget and pack (from reranked order)
    const allocation = this.allocator.allocate(loadOptions.tokenBudget, {
      complexity: loadOptions.classification?.complexity,
      scope: loadOptions.classification?.scope,
    });
    const packed = this.packChunksByPriority(reranked, allocation, loadOptions.taskTargetFile);

    const tokensAfter = packed.reduce((sum, c) => sum + Math.ceil(c.content.length / 4), 0);

    const stats: LoadStats = {
      session_id: this.options.sessionId,
      timestamp: new Date().toISOString(),
      tokens_before: tokensBefore,
      tokens_after: tokensAfter,
      reduction_pct:
        tokensBefore > 0 ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100) : 0,
      chunks_loaded: packed.length,
      rag_chunks_retrieved: ragResult.chunks_retrieved,
      rag_fallback_reason: ragResult.fallback_reason,
      retrieval_depth: depth,
      retrieval_escalated: escalated || undefined,
      reranking: rerankingCfg.enabled
        ? {
            enabled: true,
            backend: this.reranker!.backend,
            model: this.reranker!.model,
            candidate_pool_size: candidatePoolSize,
            pre_rerank_chunk_ids: rerankResult.pre_rerank_ids,
            post_rerank_chunk_ids: rerankResult.post_rerank_ids,
            latency_ms: rerankResult.latency_ms,
          }
        : undefined,
      fusion_strategy: scorerResult.fusion_strategy,
    };

    await this.persistStats(stats);

    // Action routing: suggest applicable workflows from packed chunk evidence
    let action_recommendations: ActionRecommendation[] | undefined;
    if (intelligence.action_routing?.enabled) {
      const workflowLoader = new WorkflowTemplateLoader(this.options.projectRoot);
      const workflowIds = await workflowLoader.list();
      const router = new ActionRouter();
      const suggestions = router.suggestActions(packed, loadOptions.classification, workflowIds);
      action_recommendations = suggestions.length > 0 ? suggestions : undefined;
    }

    return { chunks: packed, stats, action_recommendations };
  }

  private isSupportedFile(path: string): boolean {
    return Array.from(this.supportedExtensions).some((extension) => path.endsWith(extension));
  }

  private artifactToChunk(artifact: ResolvedArtifact): Chunk {
    const content = artifact.content ?? '';
    return {
      id: artifact.path,
      source_file: artifact.path,
      ast_node_type: 'fallback',
      ast_node_path: artifact.path,
      exported_symbols: [],
      content,
      char_count: content.replace(/\s/g, '').length,
      content_hash: '',
    };
  }

  private async persistStats(stats: LoadStats): Promise<void> {
    try {
      const statsPath = join(this.options.projectRoot, '.paqad', 'context', 'load-stats.json');
      await mkdir(dirname(statsPath), { recursive: true });
      await writeFile(statsPath, JSON.stringify(stats, null, 2), 'utf8');
    } catch {
      // non-critical
    }
  }

  private packChunksByPriority(
    chunks: Chunk[],
    allocation: {
      critical_budget: number;
      task_relevant_budget: number;
      supporting_budget: number;
    },
    taskTargetFile?: string,
  ): Chunk[] {
    const critical: Chunk[] = [];
    const taskRelevant: Chunk[] = [];
    const supporting: Chunk[] = [];

    for (const chunk of chunks) {
      const tier = this.classifyChunkPriority(chunk, taskTargetFile);
      if (tier === 'critical') {
        critical.push(chunk);
      } else if (tier === 'high' || tier === 'medium') {
        taskRelevant.push(chunk);
      } else {
        supporting.push(chunk);
      }
    }

    const packed: Chunk[] = [];
    const consume = (candidates: Chunk[], budget: number): { used: number } => {
      const next = this.allocator.packChunks(candidates, budget);
      packed.push(...next);
      const used = next.reduce((sum, chunk) => sum + Math.ceil(chunk.content.length / 4), 0);
      return { used };
    };

    const criticalResult = consume(critical, allocation.critical_budget);
    const taskBudget =
      allocation.task_relevant_budget + (allocation.critical_budget - criticalResult.used);
    const taskResult = consume(taskRelevant, taskBudget);
    const supportingBudget = allocation.supporting_budget + (taskBudget - taskResult.used);
    consume(supporting, supportingBudget);

    return packed;
  }

  private classifyChunkPriority(chunk: Chunk, taskTargetFile?: string): ContextPriorityTier {
    if (taskTargetFile && chunk.source_file === taskTargetFile) {
      return this.priorityClassifier.classify(chunk.source_file, 'current-file');
    }

    return this.priorityClassifier.classify(chunk.source_file, 'chunk');
  }
}

function loadSupportedExtensions(projectRoot: string): Set<string> {
  const defaults = new Set(['.ts', '.tsx', '.js', '.jsx', '.php', '.dart']);
  const profile = readProjectProfile(projectRoot);
  const frameworks = profile?.stack_profile?.frameworks ?? [];

  for (const pack of getPacksForFrameworks(frameworks, projectRoot)) {
    for (const extension of pack.manifest.ast?.file_extensions ?? []) {
      defaults.add(extension);
    }
  }

  return defaults;
}
