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
      return 'Xenova/all-MiniLM-L6-v2';
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
