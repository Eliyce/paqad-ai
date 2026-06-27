import type {
  ActionRoutingConfig,
  AdaptiveRetrievalConfig,
  BenchmarkEvalConfig,
  BenchmarkGateConfig,
  EmbeddingProviderName,
  IntelligenceConfig,
  MetadataFiltersConfig,
  RerankingConfig,
} from './types/project-profile.js';

export const EMBEDDING_PROVIDERS = ['local', 'openai', 'voyageai'] as const;

/**
 * A selectable local (transformers.js) embedding model (RAG buildout F23). Every entry
 * runs fully offline after a one-time shared download under `~/.paqad/models`. MiniLM is
 * the default FLOOR — small, fast, general-purpose; the code-tuned model is an opt-in
 * upgrade that closes the code-retrieval gap for offline / no-API-key users.
 */
export interface LocalEmbeddingModel {
  /** transformers.js model id (also the cache directory name). */
  id: string;
  /** Short menu label. */
  label: string;
  /** One-line description shown in the picker. */
  description: string;
  /** True for code-tuned models (vs the general-purpose floor). */
  codeTuned: boolean;
  /** True for the default floor model. Exactly one entry sets this. */
  isDefault?: boolean;
}

/**
 * The curated local embedding models. MiniLM stays the default floor; the code-tuned
 * model is opt-in and must clear the eval gate before it is recommended (the local
 * counterpart to the remote `voyage-code-3` option). Adding a model here surfaces it in
 * the `rag` setup picker — the local provider downloads any transformers.js
 * feature-extraction model, so the list is a curated, supported subset, not a hard limit.
 */
export const LOCAL_EMBEDDING_MODELS: readonly LocalEmbeddingModel[] = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'MiniLM (default, smallest)',
    description:
      'General-purpose 384-dim model. Small, fast, fully offline after a one-time shared download.',
    codeTuned: false,
    isDefault: true,
  },
  {
    id: 'Xenova/jina-embeddings-v2-base-code',
    label: 'Jina code (code-tuned, larger)',
    description:
      'Code-tuned 768-dim model for stronger code retrieval. Opt-in: a larger one-time download, still fully offline afterwards.',
    codeTuned: true,
  },
];

/** The default local model (the floor). Single source of truth for `getDefaultEmbeddingModel`. */
export const DEFAULT_LOCAL_EMBEDDING_MODEL =
  LOCAL_EMBEDDING_MODELS.find((model) => model.isDefault)?.id ?? 'Xenova/all-MiniLM-L6-v2';

/** Whether `model` is one of the curated code-tuned local models (RAG buildout F23). */
export function isCodeTunedLocalModel(model: string | undefined): boolean {
  return LOCAL_EMBEDDING_MODELS.some((entry) => entry.id === model && entry.codeTuned);
}

export const DEFAULT_BENCHMARK_EVAL: BenchmarkEvalConfig = {
  model_graded: { enabled: false },
};

export const DEFAULT_ADAPTIVE_RETRIEVAL: AdaptiveRetrievalConfig = {
  enabled: true,
  thresholds: { min_useful_chunks: 3 },
};

export const DEFAULT_RERANKING: RerankingConfig = {
  enabled: false,
  backend: 'local',
  candidate_pool_size: 50,
};

export const DEFAULT_METADATA_FILTERS: MetadataFiltersConfig = {
  enabled: true,
};

export const DEFAULT_ACTION_ROUTING: ActionRoutingConfig = {
  enabled: false,
};

export const DEFAULT_BENCHMARK_GATES: BenchmarkGateConfig = {
  hit_at_5_improvement_pct: 20,
  task_success_rate_improvement_pct: 10,
  correction_turn_reduction_pct: 15,
  prompt_token_increase_limit_pct: 10,
  prompt_token_override_success_improvement_pct: 15,
};

export function getDefaultEmbeddingModel(provider: EmbeddingProviderName): string {
  switch (provider) {
    case 'openai':
      return 'text-embedding-3-small';
    case 'voyageai':
      return 'voyage-code-3';
    case 'local':
    default:
      return DEFAULT_LOCAL_EMBEDDING_MODEL;
  }
}

export function defaultIntelligenceConfig(): IntelligenceConfig {
  return {
    rag_enabled: false,
    rag_similarity_threshold: 0.75,
    rag_top_n: 20,
    rag_max_file_size: 153600,
    benchmark_gates: { ...DEFAULT_BENCHMARK_GATES },
    benchmark_eval: { ...DEFAULT_BENCHMARK_EVAL },
    adaptive_retrieval: {
      ...DEFAULT_ADAPTIVE_RETRIEVAL,
      thresholds: { ...DEFAULT_ADAPTIVE_RETRIEVAL.thresholds! },
    },
    reranking: { ...DEFAULT_RERANKING },
    metadata_filters: { ...DEFAULT_METADATA_FILTERS },
    action_routing: { ...DEFAULT_ACTION_ROUTING },
  };
}

export function normalizeIntelligenceConfig(
  input?: Partial<IntelligenceConfig> | null,
): IntelligenceConfig {
  const defaults = defaultIntelligenceConfig();
  if (!input) {
    return defaults;
  }

  const provider = input.embedding_provider;
  const normalized: IntelligenceConfig = {
    rag_enabled: input.rag_enabled ?? defaults.rag_enabled,
    embedding_provider: provider,
    embedding_model:
      input.embedding_model ?? (provider ? getDefaultEmbeddingModel(provider) : undefined),
    rag_similarity_threshold: input.rag_similarity_threshold ?? defaults.rag_similarity_threshold,
    rag_top_n: input.rag_top_n ?? defaults.rag_top_n,
    rag_max_file_size: input.rag_max_file_size ?? defaults.rag_max_file_size,
    rag_base_branch: input.rag_base_branch ?? defaults.rag_base_branch,
    benchmark_gates: {
      ...DEFAULT_BENCHMARK_GATES,
      ...(input.benchmark_gates ?? {}),
    },
    benchmark_eval: {
      ...DEFAULT_BENCHMARK_EVAL,
      ...(input.benchmark_eval ?? {}),
      model_graded: {
        enabled:
          input.benchmark_eval?.model_graded?.enabled ??
          DEFAULT_BENCHMARK_EVAL.model_graded?.enabled ??
          false,
      },
    },
    adaptive_retrieval: {
      ...DEFAULT_ADAPTIVE_RETRIEVAL,
      ...(input.adaptive_retrieval ?? {}),
      thresholds: {
        min_useful_chunks:
          input.adaptive_retrieval?.thresholds?.min_useful_chunks ??
          DEFAULT_ADAPTIVE_RETRIEVAL.thresholds!.min_useful_chunks,
      },
    },
    reranking: {
      ...DEFAULT_RERANKING,
      ...(input.reranking ?? {}),
    },
    metadata_filters: {
      ...DEFAULT_METADATA_FILTERS,
      ...(input.metadata_filters ?? {}),
    },
    action_routing: {
      ...DEFAULT_ACTION_ROUTING,
      ...(input.action_routing ?? {}),
    },
  };

  if (normalized.rag_enabled && normalized.embedding_provider && !normalized.embedding_model) {
    normalized.embedding_model = getDefaultEmbeddingModel(normalized.embedding_provider);
  }

  return normalized;
}
