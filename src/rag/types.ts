import type { Chunk, ChunkIndex } from '@/context/types.js';
import type { EmbeddingProviderName, IntelligenceConfig } from '@/core/types/project-profile.js';

export type EmbeddingProviderErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'download_failed'
  | 'provider_error';

export class EmbeddingProviderError extends Error {
  constructor(
    readonly provider: EmbeddingProviderName,
    readonly code: EmbeddingProviderErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

export function isEmbeddingProviderError(error: unknown): error is EmbeddingProviderError {
  return error instanceof EmbeddingProviderError;
}

export interface RagIndexMeta {
  version: 1;
  provider: EmbeddingProviderName;
  model: string;
  built_at: string;
  chunk_count: number;
  embedding_dimensions: number;
}

export interface StoredVectorItem {
  id: string;
  vector: number[];
}

export interface StoredVectorChunk extends Chunk, StoredVectorItem {
  vector: number[];
}

export interface VectorIndexPayload<T extends StoredVectorItem = StoredVectorItem> {
  version: 1;
  dimensions: number;
  items: T[];
}

export interface VectorQueryResult<T extends StoredVectorItem = StoredVectorItem> {
  score: number;
  item: T;
}

export interface RagStatus {
  enabled: boolean;
  configured_provider?: EmbeddingProviderName;
  configured_model?: string;
  index_present: boolean;
  valid: boolean;
  /** True when the stored index was built with a different provider/model than currently configured. */
  stale_metadata?: boolean;
  built_at?: string;
  chunk_count: number;
  size_bytes: number;
  reason?: string;
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  validate(): Promise<void>;
  embed(input: string | string[]): Promise<number[][]>;
}

export interface LocalEmbeddingProgress {
  loaded?: number;
  total?: number;
  status?: string;
}

export interface LocalEmbeddingOutput {
  tolist?: () => number[] | number[][];
}

export interface LocalEmbeddingExtractor {
  (
    input: string[],
    options: {
      pooling: 'mean';
      normalize: true;
    },
  ): Promise<LocalEmbeddingOutput | number[] | number[][]>;
}

export interface TransformersRuntimeEnv {
  cacheDir?: string;
  localModelPath?: string;
  allowLocalModels?: boolean;
  allowRemoteModels?: boolean;
}

export interface OpenAiEmbeddingClient {
  embeddings: {
    create(input: {
      model: string;
      input: string | string[];
    }): Promise<{ data: Array<{ embedding: number[] }> }>;
  };
}

export interface VoyageEmbeddingClient {
  embed(input: {
    input: string | string[];
    model: string;
  }): Promise<{ data: Array<{ embedding: number[] }> }>;
}

export interface ProviderProgressUpdate {
  phase: 'download' | 'load' | 'build';
  message: string;
  loaded?: number;
  total?: number;
  percent?: number;
}

export interface ChunkIndexSyncResult {
  index: ChunkIndex;
  changed_files: string[];
  added_files: string[];
  deleted_files: string[];
  updated: boolean;
}

export interface RagRetrievalResult {
  vector_scores: Map<string, number>;
  chunks_retrieved: number;
  retrieved_chunk_ids: string[];
  retrieved_source_files: string[];
  retrieved_chunks: Array<Pick<StoredVectorChunk, 'id' | 'source_file' | 'content'>>;
  fallback_reason?: string;
}

export interface BuildIndexOptions {
  intelligence?: IntelligenceConfig;
  onProgress?: (update: ProviderProgressUpdate) => void;
}

export type ProviderFactory = (
  projectRoot: string,
  intelligence: IntelligenceConfig,
  onProgress?: (update: ProviderProgressUpdate) => void,
) => Promise<EmbeddingProvider>;

// ── Evaluation types ──────────────────────────────────────────────────────────

export type ComparisonMode = 'lexical-vs-rag' | 'rag-vs-candidate' | 'feature-off-vs-on';

export type EvalQueryClass =
  | 'simple-lexical'
  | 'vocabulary-mismatch'
  | 'ambiguous'
  | 'multi-part'
  | 'workflow-triggering'
  | 'negative';

export interface EvalDatasetItem {
  id: string;
  query_class: EvalQueryClass;
  task_description: string;
  keywords: string[];
  expected_file?: string;
  should_skip_retrieval?: boolean;
  workflow_trigger?: string;
}

export interface EvalTrace {
  item_id: string;
  retrieval_depth?: string;
  first_stage_chunk_ids: string[];
  applied_metadata_filters?: string[];
  reranked_chunk_ids?: string[];
  packed_chunk_ids: string[];
  packed_token_count?: number;
  routed_workflow_id?: string;
  final_answer_or_recommendation?: string;
}

export interface ModelGradedScores {
  retrieval_relevance: number;
  answer_faithfulness: number;
  action_recommendation_usefulness: number;
  routing_correctness: number;
}

export interface EvalRunResult {
  mode: ComparisonMode;
  timestamp: string;
  dataset_size: number;
  traces: EvalTrace[];
  model_graded?: ModelGradedScores;
}
