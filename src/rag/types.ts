import type { Chunk, ChunkIndex } from '@/context/types.js';
import { FrameworkError } from '@/core/errors/framework-error.js';
import type { EmbeddingProviderName, IntelligenceConfig } from '@/core/types/project-profile.js';

export type EmbeddingProviderErrorCode =
  'missing_api_key' | 'invalid_api_key' | 'rate_limited' | 'download_failed' | 'provider_error';

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
  branch?: string;
  base_branch?: string;
  base_commit?: string;
  head_commit?: string;
  chunker_version?: string;
}

export interface StoredVectorItem {
  id: string;
  vector: number[];
}

export interface StoredVectorChunk extends Chunk, StoredVectorItem {
  vector: number[];
}

export type ExtractionKind = 'ocr' | 'caption';

export const SUPPORTED_EXTRACTION_KINDS = [
  'ocr',
  'caption',
] as const satisfies readonly ExtractionKind[];

export const SUPPORTED_VISION_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.tiff',
  '.bmp',
  '.avif',
  '.heic',
] as const;

export interface VisionIngestInput {
  sourcePath: string;
  text: string;
  extractionKind: ExtractionKind;
}

export interface VisionIngestResult {
  chunkCount: number;
  sourcePath: string;
  extractionKind: ExtractionKind;
}

export interface VisionChunk extends Chunk {
  extraction_kind: ExtractionKind;
  source_missing?: boolean;
}

export interface StoredVisionChunk extends VisionChunk, StoredVectorItem {
  vector: number[];
}

export type RagIngestErrorCode =
  | 'unsupported_file_type'
  | 'unknown_extraction_kind'
  | 'empty_extracted_text'
  | 'path_outside_project'
  | 'text_not_utf8';

export class RagIngestError extends FrameworkError {
  declare readonly code: RagIngestErrorCode;

  constructor(code: RagIngestErrorCode, message: string, details?: Record<string, unknown>) {
    super(message, { code, details });
    this.name = 'RagIngestError';
  }
}

export function isRagIngestError(error: unknown): error is RagIngestError {
  return error instanceof RagIngestError;
}

export type CrsCollectionId = string & { readonly __crsCollectionId: unique symbol };

export function toCrsCollectionId(id: string): CrsCollectionId {
  if (id.trim().length === 0) {
    throw new Error('CRS collection id must be a non-empty string');
  }
  return id as CrsCollectionId;
}

export interface CrsChunkInput {
  id: string;
  content: string;
  source_session_id: string;
  source_workspace_id: string;
  created_at: string;
  project_id: string;
}

export interface CrsChunk extends StoredVectorItem {
  content: string;
  source_session_id: string;
  source_workspace_id: string;
  created_at: string;
  project_id: string;
  vector_timestamp: string;
}

export interface CrsRetrievalResult {
  chunk: CrsChunk;
  sourceSessionId: string;
  sourceWorkspaceId: string;
  score: number;
}

export interface CrsIndexedSessionEvent {
  session_id: string;
  project_id: string;
  chunk_count: number;
}

export interface ReindexProgressEvent {
  status_percent: number;
  current_collection: string;
  est_time: number;
}

export type ReindexProgressHandler = (event: ReindexProgressEvent) => void;

export class EmbeddingBacklogOverflow extends Error {
  constructor(
    readonly dropped_count: number,
    message?: string,
  ) {
    super(message ?? `Embedding backlog overflow: dropped ${dropped_count} pending chunk(s)`);
    this.name = 'EmbeddingBacklogOverflow';
  }
}

export function isEmbeddingBacklogOverflow(error: unknown): error is EmbeddingBacklogOverflow {
  return error instanceof EmbeddingBacklogOverflow;
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
  stale_metadata?: boolean;
  built_at?: string;
  chunk_count: number;
  size_bytes: number;
  reason?: string;
  vision_chunk_count?: number;
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
  best_score?: number;
  low_confidence?: boolean;
}

export interface RagScoredCandidate {
  id: string;
  source_file: string;
  content: string;
  score: number;
}

export interface BuildIndexOptions {
  intelligence?: IntelligenceConfig;
  onProgress?: (update: ProviderProgressUpdate) => void;
  signal?: AbortSignal;
}

export type ProviderFactory = (
  projectRoot: string,
  intelligence: IntelligenceConfig,
  onProgress?: (update: ProviderProgressUpdate) => void,
) => Promise<EmbeddingProvider>;

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
