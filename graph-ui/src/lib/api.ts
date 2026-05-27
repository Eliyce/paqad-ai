import type { DashboardReport } from './dashboard-types';
import type { ChunkContentResponse, Graph, NodeDetail } from './types';

export async function fetchDashboard(): Promise<DashboardReport> {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error('Failed to fetch /api/dashboard: ' + res.status);
  return (await res.json()) as DashboardReport;
}

export async function fetchGraph(): Promise<Graph> {
  const res = await fetch('/api/graph');
  if (!res.ok) throw new Error('Failed to fetch /api/graph: ' + res.status);
  return (await res.json()) as Graph;
}

export async function fetchNodeDetail(nodeId: string): Promise<NodeDetail> {
  const res = await fetch('/api/node/' + encodeURIComponent(nodeId));
  if (!res.ok) throw new Error('Failed to fetch detail: ' + res.status);
  return (await res.json()) as NodeDetail;
}

export async function fetchChunkContent(chunkId: string): Promise<ChunkContentResponse> {
  const res = await fetch('/api/chunk/' + encodeURIComponent(chunkId) + '/content');
  if (!res.ok) throw new Error('Failed to fetch chunk content: ' + res.status);
  return (await res.json()) as ChunkContentResponse;
}

export interface SimilarityRequest {
  threshold: number;
  scope: { type: 'all' | 'module' | 'file' | 'chunk'; id: string | null };
  max_edges?: number;
}

export interface SimilarityResponse {
  threshold: number;
  scope: { type: string; id: string | null };
  edges: import('./types').GraphEdge[];
  capped: boolean;
}

export async function fetchSimilar(req: SimilarityRequest): Promise<SimilarityResponse> {
  const res = await fetch('/api/similar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error('Failed to fetch /api/similar: ' + res.status);
  return (await res.json()) as SimilarityResponse;
}
