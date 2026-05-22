export type GraphNodeType = 'module' | 'file' | 'chunk' | 'symbol';

export type GraphEdgeType = 'contains' | 'imports' | 'embeds' | 'similar' | 'defines';

export type ModuleHealthTier = 'green' | 'amber' | 'red' | 'unknown';

export interface GraphNodeAttributes {
  // module
  health_tier?: ModuleHealthTier | null;
  defect_count?: number | null;
  risk_floor?: number | null;
  complexity_correction?: number | null;
  // file
  language?: string | null;
  symbol_count?: number | null;
  size_bytes?: number | null;
  // chunk
  chunk_index?: number | null;
  start_line?: number | null;
  end_line?: number | null;
  content_hash?: string | null;
  ast_node_type?: string | null;
  // symbol
  symbol_kind?: string | null;
  exported?: boolean | null;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  parent_id: string | null;
  attributes: GraphNodeAttributes;
}

export interface GraphEdgeAttributes {
  depth?: number | null;
}

export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  source: string;
  target: string;
  weight: number | null;
  attributes: GraphEdgeAttributes;
}

export interface GraphMetaCounts {
  modules: number;
  files: number;
  chunks: number;
  symbols: number;
  imports: number;
}

export interface GraphOverlaysAvailable {
  health: boolean;
  defects: boolean;
  risk_floor: boolean;
  complexity_correction: boolean;
}

export interface GraphMeta {
  project_root: string;
  extracted_at: string;
  paqad_version: string;
  counts: GraphMetaCounts;
  similarity_edges_available: boolean;
  overlays_available: GraphOverlaysAvailable;
  degraded_reasons: string[];
}

export interface Graph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NodeDetail {
  node: GraphNode;
  parent: GraphNode | null;
  children: GraphNode[];
  neighbours: GraphNode[];
  // file-specific
  imports_in?: { file_id: string; module_id: string | null }[];
  imports_out?: { file_id: string; module_id: string | null }[];
  // chunk-specific
  chunk_content_preview?: string;
  chunk_truncated?: boolean;
  // module-specific
  health_history?: { date: string; tier: ModuleHealthTier }[];
  defect_samples?: { id: string; summary: string; recency: string }[];
  complexity_correction_history?: { date: string; correction: number }[];
}

export interface SimilarityRequestScope {
  type: 'all' | 'module' | 'file' | 'chunk';
  id: string | null;
}

export interface SimilarityRequest {
  threshold: number;
  scope: SimilarityRequestScope;
  max_edges?: number;
}

export interface SimilarityResponse {
  threshold: number;
  scope: SimilarityRequestScope;
  edges: GraphEdge[];
  capped: boolean;
}
