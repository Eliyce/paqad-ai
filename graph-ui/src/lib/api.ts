import type {
  AiBomResponse,
  ApprovalsFeed,
  DashboardReport,
  DeliveryPolicyConfigResponse,
  DeliveryPolicyIssue,
  EvidenceFeed,
  InventoryReport,
  PutDeliveryPolicyOutcome,
  ReceiptFeed,
  ResolvedDeliveryPolicy,
} from './dashboard-types';
import type { ChunkContentResponse, Graph, NodeDetail } from './types';

export async function fetchDashboard(): Promise<DashboardReport> {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error('Failed to fetch /api/dashboard: ' + res.status);
  return (await res.json()) as DashboardReport;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // fall through to the status line
  }
  return 'Request failed with status ' + res.status;
}

export async function fetchInventory(): Promise<InventoryReport> {
  const res = await fetch('/api/inventory');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as InventoryReport;
}

export async function fetchApprovals(): Promise<ApprovalsFeed> {
  const res = await fetch('/api/decisions');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ApprovalsFeed;
}

export async function resolvePause(
  id: string,
  chosenOptionKey: string,
  note?: string,
): Promise<void> {
  const res = await fetch('/api/decisions/' + encodeURIComponent(id) + '/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chosen_option_key: chosenOptionKey, ...(note ? { note } : {}) }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function actOnModuleProposal(id: string, action: 'accept' | 'reject'): Promise<void> {
  const res = await fetch('/api/module-decisions/' + encodeURIComponent(id) + '/' + action, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function fetchDeliveryPolicyConfig(): Promise<DeliveryPolicyConfigResponse> {
  const res = await fetch('/api/config/delivery-policy');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as DeliveryPolicyConfigResponse;
}

/**
 * PUT the delivery policy. Validation (422) and edit conflicts (409) are
 * expected outcomes the editor renders, so they come back as values; only
 * transport and guard failures (403, network) throw.
 */
export async function putDeliveryPolicy(input: {
  content: string;
  baseHash: string | null;
}): Promise<PutDeliveryPolicyOutcome> {
  const res = await fetch('/api/config/delivery-policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) {
    const body = (await res.json()) as {
      result: { path: string; hash: string; resolved: ResolvedDeliveryPolicy };
    };
    return { status: 'ok', ...body.result };
  }
  if (res.status === 422) {
    const body = (await res.json()) as { error?: string; issues?: DeliveryPolicyIssue[] };
    return {
      status: 'invalid',
      error: body.error ?? 'The policy does not match the schema.',
      issues: body.issues ?? [],
    };
  }
  if (res.status === 409) {
    const body = (await res.json()) as {
      error?: string;
      conflict?: { content: string | null; hash: string | null };
    };
    if (body.conflict) {
      return {
        status: 'conflict',
        error: body.error ?? 'The file changed since you loaded it.',
        conflict: body.conflict,
      };
    }
    throw new Error(body.error ?? 'Request failed with status 409');
  }
  throw new Error(await errorMessage(res));
}

export async function fetchEvidence(filters: {
  gate?: string;
  verdict?: string;
}): Promise<EvidenceFeed> {
  const params = new URLSearchParams();
  if (filters.gate) params.set('gate', filters.gate);
  if (filters.verdict) params.set('verdict', filters.verdict);
  const query = params.toString();
  const res = await fetch('/api/ledger/evidence' + (query ? '?' + query : ''));
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as EvidenceFeed;
}

export async function fetchReceipts(): Promise<ReceiptFeed> {
  const res = await fetch('/api/ledger/receipts');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ReceiptFeed;
}

export async function fetchAiBom(): Promise<AiBomResponse> {
  const res = await fetch('/api/ledger/ai-bom');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as AiBomResponse;
}

export async function fetchPrComment(): Promise<string> {
  const res = await fetch('/api/ledger/pr-comment');
  if (!res.ok) throw new Error(await errorMessage(res));
  return await res.text();
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
