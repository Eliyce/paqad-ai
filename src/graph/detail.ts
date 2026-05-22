import type { ChunkContentRecord } from './extractor.js';
import type { Graph, GraphNode, NodeDetail } from './types.js';

const CHUNK_PREVIEW_CLIP = 500;

export interface NeighbourIndex {
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  /** edges grouped by node id, with the *other* endpoint and the edge type */
  edgesByNode: Map<string, { other: string; type: string; isOut: boolean }[]>;
  nodeById: Map<string, GraphNode>;
}

export function buildNeighbourIndex(graph: Graph): NeighbourIndex {
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  const edgesByNode = new Map<string, { other: string; type: string; isOut: boolean }[]>();
  const nodeById = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeById.set(n.id, n);
    parent.set(n.id, n.parent_id);
    if (n.parent_id) {
      const arr = children.get(n.parent_id) ?? [];
      arr.push(n.id);
      children.set(n.parent_id, arr);
    }
  }
  for (const e of graph.edges) {
    const sourceList = edgesByNode.get(e.source) ?? [];
    sourceList.push({ other: e.target, type: e.type, isOut: true });
    edgesByNode.set(e.source, sourceList);
    const targetList = edgesByNode.get(e.target) ?? [];
    targetList.push({ other: e.source, type: e.type, isOut: false });
    edgesByNode.set(e.target, targetList);
  }
  return { parent, children, edgesByNode, nodeById };
}

export function buildNodeDetail(
  graph: Graph,
  nodeId: string,
  options?: { chunkContents?: Map<string, ChunkContentRecord>; index?: NeighbourIndex },
): NodeDetail | null {
  const index = options?.index ?? buildNeighbourIndex(graph);
  const node = index.nodeById.get(nodeId);
  if (!node) return null;
  const parentNode = node.parent_id ? (index.nodeById.get(node.parent_id) ?? null) : null;
  const childIds = index.children.get(nodeId) ?? [];
  const children = childIds
    .map((id) => index.nodeById.get(id))
    .filter((n): n is GraphNode => Boolean(n));
  const edges = index.edgesByNode.get(nodeId) ?? [];
  const neighbourIdSet = new Set<string>();
  for (const e of edges) neighbourIdSet.add(e.other);
  const neighbours = Array.from(neighbourIdSet)
    .map((id) => index.nodeById.get(id))
    .filter((n): n is GraphNode => Boolean(n));

  const detail: NodeDetail = {
    node,
    parent: parentNode,
    children,
    neighbours,
  };

  if (node.type === 'file') {
    const out: { file_id: string; module_id: string | null }[] = [];
    const inc: { file_id: string; module_id: string | null }[] = [];
    for (const e of edges) {
      if (e.type !== 'imports') continue;
      const other = index.nodeById.get(e.other);
      if (!other) continue;
      const record = { file_id: other.id, module_id: other.parent_id };
      if (e.isOut) out.push(record);
      else inc.push(record);
    }
    detail.imports_out = out;
    detail.imports_in = inc;
  }

  if (node.type === 'chunk') {
    const record = options?.chunkContents?.get(nodeId);
    if (record) {
      const truncated = record.content.length > CHUNK_PREVIEW_CLIP;
      detail.chunk_content_preview = truncated
        ? record.content.slice(0, CHUNK_PREVIEW_CLIP)
        : record.content;
      detail.chunk_truncated = truncated;
    } else {
      detail.chunk_content_preview = '';
      detail.chunk_truncated = false;
    }
  }

  if (node.type === 'module') {
    // Phase 3 keeps these stubbed; richer history lands when health ledger
    // begins recording diffs. The shape is preserved per FR-4.
    detail.health_history = [];
    detail.defect_samples = [];
    detail.complexity_correction_history = [];
  }

  return detail;
}

export const CHUNK_PREVIEW_CLIP_CHARS = CHUNK_PREVIEW_CLIP;
