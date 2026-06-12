// Mirror of the server-side graph types. Kept manually in sync with
// src/graph/types.ts in the parent package — only fields used by the UI.

export type GraphNodeType = 'module' | 'file' | 'chunk' | 'symbol';
export type GraphEdgeType = 'contains' | 'imports' | 'embeds' | 'similar' | 'defines';
export type ModuleHealthTier = 'green' | 'amber' | 'red' | 'unknown';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  parent_id: string | null;
  attributes: {
    health_tier?: ModuleHealthTier | null;
    defect_count?: number | null;
    risk_floor?: number | null;
    complexity_correction?: number | null;
    language?: string | null;
    symbol_count?: number | null;
    size_bytes?: number | null;
    chunk_index?: number | null;
    content_hash?: string | null;
    ast_node_type?: string | null;
    exported?: boolean | null;
  };
}

export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  source: string;
  target: string;
  weight: number | null;
  attributes: { depth?: number | null };
}

export interface GraphMeta {
  project_root: string;
  extracted_at: string;
  paqad_version: string;
  counts: {
    modules: number;
    files: number;
    chunks: number;
    symbols: number;
    imports: number;
  };
  similarity_edges_available: boolean;
  overlays_available: {
    health: boolean;
    defects: boolean;
    risk_floor: boolean;
    complexity_correction: boolean;
  };
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
  imports_in?: { file_id: string; module_id: string | null }[];
  imports_out?: { file_id: string; module_id: string | null }[];
  chunk_content_preview?: string;
  chunk_truncated?: boolean;
  health_history?: { date: string; tier: ModuleHealthTier }[];
  defect_samples?: { id: string; summary: string; recency: string }[];
  complexity_correction_history?: { date: string; correction: number }[];
}

export interface ChunkContentResponse {
  chunk_id: string;
  file: string;
  chunk_index: number;
  content: string;
}
