import {
  DEFAULT_ACTION_ROUTING,
  DEFAULT_ADAPTIVE_RETRIEVAL,
  DEFAULT_BENCHMARK_EVAL,
  DEFAULT_BENCHMARK_GATES,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_METADATA_FILTERS,
  DEFAULT_RERANKING,
  LOCAL_EMBEDDING_MODELS,
  defaultIntelligenceConfig,
  getDefaultEmbeddingModel,
  isCodeTunedLocalModel,
  normalizeIntelligenceConfig,
} from '@/core/project-intelligence.js';

describe('project intelligence defaults', () => {
  it('returns the documented default embedding model per provider', () => {
    expect(getDefaultEmbeddingModel('local')).toBe('Xenova/all-MiniLM-L6-v2');
    expect(getDefaultEmbeddingModel('openai')).toBe('text-embedding-3-small');
    expect(getDefaultEmbeddingModel('voyageai')).toBe('voyage-code-3');
  });

  describe('local embedding models (F23)', () => {
    it('keeps MiniLM as the default floor', () => {
      expect(DEFAULT_LOCAL_EMBEDDING_MODEL).toBe('Xenova/all-MiniLM-L6-v2');
      expect(getDefaultEmbeddingModel('local')).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
      const floor = LOCAL_EMBEDDING_MODELS.find((m) => m.isDefault);
      expect(floor?.id).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
      expect(floor?.codeTuned).toBe(false);
    });

    it('offers exactly one default and at least one opt-in code-tuned model', () => {
      expect(LOCAL_EMBEDDING_MODELS.filter((m) => m.isDefault)).toHaveLength(1);
      expect(LOCAL_EMBEDDING_MODELS.some((m) => m.codeTuned)).toBe(true);
    });

    it('identifies code-tuned models, not the floor or unknown ids', () => {
      expect(isCodeTunedLocalModel('Xenova/jina-embeddings-v2-base-code')).toBe(true);
      expect(isCodeTunedLocalModel('Xenova/all-MiniLM-L6-v2')).toBe(false);
      expect(isCodeTunedLocalModel('something/unknown')).toBe(false);
      expect(isCodeTunedLocalModel(undefined)).toBe(false);
    });
  });

  it('provides a stable disabled-by-default intelligence config', () => {
    expect(defaultIntelligenceConfig()).toEqual({
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      rag_max_file_size: 153600,
      benchmark_gates: DEFAULT_BENCHMARK_GATES,
      benchmark_eval: DEFAULT_BENCHMARK_EVAL,
      adaptive_retrieval: {
        ...DEFAULT_ADAPTIVE_RETRIEVAL,
        thresholds: { ...DEFAULT_ADAPTIVE_RETRIEVAL.thresholds },
      },
      reranking: { ...DEFAULT_RERANKING },
      metadata_filters: { ...DEFAULT_METADATA_FILTERS },
      action_routing: { ...DEFAULT_ACTION_ROUTING },
    });
  });

  it('normalizes provider-specific defaults and merges benchmark overrides', () => {
    expect(
      normalizeIntelligenceConfig({
        rag_enabled: true,
        embedding_provider: 'openai',
        benchmark_gates: { hit_at_5_improvement_pct: 30 } as never,
      }),
    ).toMatchObject({
      rag_enabled: true,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      rag_max_file_size: 153600,
      benchmark_gates: {
        hit_at_5_improvement_pct: 30,
        task_success_rate_improvement_pct: 10,
      },
    });
  });

  it('uses default benchmark_eval when not provided', () => {
    const config = normalizeIntelligenceConfig({ rag_enabled: false });
    expect(config.benchmark_eval).toEqual(DEFAULT_BENCHMARK_EVAL);
    expect(config.benchmark_eval?.model_graded?.enabled).toBe(false);
    expect(config.rag_max_file_size).toBe(153600);
  });

  it('merges provided benchmark_eval with defaults', () => {
    const config = normalizeIntelligenceConfig({
      benchmark_eval: { model_graded: { enabled: true } },
    });
    expect(config.benchmark_eval?.model_graded?.enabled).toBe(true);
  });

  it('returns defaults when normalizeIntelligenceConfig receives null', () => {
    const config = normalizeIntelligenceConfig(null);
    expect(config).toEqual(defaultIntelligenceConfig());
  });

  it('uses default adaptive_retrieval when not provided', () => {
    const config = normalizeIntelligenceConfig({ rag_enabled: false });
    expect(config.adaptive_retrieval?.enabled).toBe(true);
    expect(config.adaptive_retrieval?.thresholds?.min_useful_chunks).toBe(3);
  });

  it('merges provided adaptive_retrieval thresholds with defaults', () => {
    const config = normalizeIntelligenceConfig({
      adaptive_retrieval: { enabled: false, thresholds: { min_useful_chunks: 10 } },
    });
    expect(config.adaptive_retrieval?.enabled).toBe(false);
    expect(config.adaptive_retrieval?.thresholds?.min_useful_chunks).toBe(10);
  });

  it('uses default reranking config when not provided', () => {
    const config = normalizeIntelligenceConfig({ rag_enabled: false });
    expect(config.reranking?.enabled).toBe(false);
    expect(config.reranking?.backend).toBe('local');
    expect(config.reranking?.candidate_pool_size).toBe(50);
  });

  it('merges provided reranking config with defaults', () => {
    const config = normalizeIntelligenceConfig({
      reranking: { enabled: true, backend: 'cohere', candidate_pool_size: 30 },
    });
    expect(config.reranking?.enabled).toBe(true);
    expect(config.reranking?.backend).toBe('cohere');
    expect(config.reranking?.candidate_pool_size).toBe(30);
  });

  it('uses default metadata_filters when not provided', () => {
    const config = normalizeIntelligenceConfig({ rag_enabled: false });
    expect(config.metadata_filters?.enabled).toBe(true);
  });

  it('normalizes metadata_filters with provided value', () => {
    const config = normalizeIntelligenceConfig({
      metadata_filters: { enabled: false },
    });
    expect(config.metadata_filters?.enabled).toBe(false);
  });

  it('uses default action_routing when not provided (disabled)', () => {
    const config = normalizeIntelligenceConfig({ rag_enabled: false });
    expect(config.action_routing?.enabled).toBe(false);
  });

  it('normalizes action_routing with provided value', () => {
    const config = normalizeIntelligenceConfig({
      action_routing: { enabled: true },
    });
    expect(config.action_routing?.enabled).toBe(true);
  });

  it('reranking config is independent of embedding config', () => {
    const config = normalizeIntelligenceConfig({
      rag_enabled: true,
      embedding_provider: 'openai',
      reranking: { enabled: true, backend: 'local' },
    });
    expect(config.embedding_provider).toBe('openai');
    expect(config.reranking?.backend).toBe('local');
  });
});
