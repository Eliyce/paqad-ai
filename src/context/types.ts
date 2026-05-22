export type RetrievalDepth = 'none' | 'standard' | 'deep';

export interface Chunk {
  id: string;
  source_file: string;
  ast_node_type: 'function' | 'class' | 'method' | 'import-block' | 'constant' | 'fallback';
  ast_node_path: string;
  exported_symbols: string[];
  content: string;
  char_count: number; // non-whitespace chars
  content_hash: string;
  modified_at_ms?: number;
}

export interface ChunkIndexEntry {
  source_file: string;
  source_file_hash: string;
  modified_at: string;
  chunks: Chunk[];
}

export interface ChunkIndex {
  version: 1;
  generated_at: string;
  entries: ChunkIndexEntry[];
}

export interface LoadStats {
  session_id: string;
  timestamp: string;
  tokens_before: number;
  tokens_after: number;
  reduction_pct: number;
  chunks_loaded: number;
  rag_chunks_retrieved?: number;
  rag_fallback_reason?: string;
  retrieval_depth?: RetrievalDepth;
  retrieval_escalated?: boolean;
  reranking?: {
    enabled: boolean;
    backend: string;
    model: string;
    candidate_pool_size: number;
    pre_rerank_chunk_ids: string[];
    post_rerank_chunk_ids: string[];
    latency_ms: number;
  };
  fusion_strategy?: FusionDiagnostic;
}

export interface ActionRecommendation {
  action_type: 'workflow';
  confidence: number;
  evidence_chunk_ids: string[];
  workflow_id: string;
  explanation: string;
  requires_user_approval: true;
}

export interface FusionDiagnostic {
  signals: string[];
  filters_applied: string[];
  filter_fallback?: boolean;
  filter_fallback_reason?: string;
}

export interface SemanticLoadClassification {
  complexity?: 'trivial' | 'low' | 'medium' | 'high' | 'very-high';
  risk?: 'low' | 'medium' | 'high';
  scope?: 'single-file' | 'single-module' | 'multi-module' | 'system-wide';
  workflow?: string | null;
  affected_modules?: string[];
  file_extension?: string;
  frameworks?: string[];
  recency_cutoff_ms?: number;
}

export interface SemanticLoadOptions {
  taskKeywords: string[];
  taskDescription?: string;
  taskTargetFile?: string;
  symbolReferences?: string[];
  tokenBudget: number;
  fullContextOverride?: boolean;
  classification?: SemanticLoadClassification;
}
