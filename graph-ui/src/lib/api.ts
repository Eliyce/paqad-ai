import type {
  AiBomResponse,
  ApprovalsFeed,
  AuditFeedPage,
  DashboardPack,
  DashboardReport,
  DeliveryPolicyConfigResponse,
  DeliveryPolicyIssue,
  DesignTokensConfigResponse,
  EvidenceFeed,
  InstallPackResult,
  InstructionsFileResponse,
  InstructionsTreeResponse,
  InventoryReport,
  ManagedFileInfo,
  ModuleMapConfigResponse,
  MutationOutcome,
  OnboardingChecklist,
  OpsAction,
  OpsJob,
  ProfileConfigResponse,
  PutDeliveryPolicyOutcome,
  PutDesignTokensResult,
  PutManagedFileResult,
  PutModuleMapResult,
  PutProfileResult,
  PutRagResult,
  RagConfigResponse,
  ReceiptFeed,
  RemovePackResult,
  ResolvedDeliveryPolicy,
  SetCapabilityResult,
  ValidationIssue,
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

/**
 * Shared mutation transport for the issue #146 editors. Validation (422)
 * and edit conflicts (409 with a `conflict` body) are expected outcomes the
 * editors render, so they come back as values; everything else (403
 * read-only, guard refusals, network) throws with the server's sentence.
 */
async function mutate<T>(
  url: string,
  method: 'PUT' | 'POST',
  body: unknown,
): Promise<MutationOutcome<T>> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const payload = (await res.json()) as { result: T };
    return { status: 'ok', result: payload.result };
  }
  if (res.status === 422) {
    const payload = (await res.json()) as { error?: string; issues?: ValidationIssue[] };
    return {
      status: 'invalid',
      error: payload.error ?? 'The change failed validation.',
      issues: payload.issues ?? [],
    };
  }
  if (res.status === 409) {
    const payload = (await res.json()) as {
      error?: string;
      conflict?: { content: string | null; hash: string | null };
    };
    if (payload.conflict) {
      return {
        status: 'conflict',
        error: payload.error ?? 'The file changed since you loaded it.',
        conflict: payload.conflict,
      };
    }
    throw new Error(payload.error ?? 'Request failed with status 409');
  }
  throw new Error(await errorMessage(res));
}

/* Project profile + capabilities */

export async function fetchProfileConfig(): Promise<ProfileConfigResponse> {
  const res = await fetch('/api/config/profile');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ProfileConfigResponse;
}

export async function putProfile(
  profile: Record<string, unknown>,
): Promise<MutationOutcome<PutProfileResult>> {
  return mutate('/api/config/profile', 'PUT', { profile });
}

export async function setCapability(
  name: string,
  enabled: boolean,
): Promise<MutationOutcome<SetCapabilityResult>> {
  return mutate('/api/capabilities/' + encodeURIComponent(name), 'POST', { enabled });
}

/* Module map */

export async function fetchModuleMapConfig(): Promise<ModuleMapConfigResponse> {
  const res = await fetch('/api/config/module-map');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ModuleMapConfigResponse;
}

export async function putModuleMap(input: {
  content: string;
  baseHash: string | null;
}): Promise<MutationOutcome<PutModuleMapResult>> {
  return mutate('/api/config/module-map', 'PUT', input);
}

/* RAG settings */

export async function fetchRagConfig(): Promise<RagConfigResponse> {
  const res = await fetch('/api/config/rag');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as RagConfigResponse;
}

export async function putRagConfig(
  intelligence: Record<string, unknown>,
): Promise<MutationOutcome<PutRagResult>> {
  return mutate('/api/config/rag', 'PUT', { intelligence });
}

/* Decision contract */

export async function fetchDecisionContract(): Promise<ManagedFileInfo> {
  const res = await fetch('/api/config/decision-contract');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as ManagedFileInfo;
}

export async function putDecisionContract(input: {
  content: string;
  baseHash: string | null;
}): Promise<MutationOutcome<PutManagedFileResult>> {
  return mutate('/api/config/decision-contract', 'PUT', input);
}

/* Design tokens */

export async function fetchDesignTokensConfig(): Promise<DesignTokensConfigResponse> {
  const res = await fetch('/api/config/design-tokens');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as DesignTokensConfigResponse;
}

export async function putDesignTokens(input: {
  content: string;
  baseHash: string | null;
}): Promise<MutationOutcome<PutDesignTokensResult>> {
  return mutate('/api/config/design-tokens', 'PUT', input);
}

/* Instructions files */

export async function fetchInstructionsTree(): Promise<InstructionsTreeResponse> {
  const res = await fetch('/api/files/instructions');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as InstructionsTreeResponse;
}

export async function fetchInstructionsFile(path: string): Promise<InstructionsFileResponse> {
  const res = await fetch(
    '/api/files/instructions/' + path.split('/').map(encodeURIComponent).join('/'),
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as InstructionsFileResponse;
}

export async function putInstructionsFile(
  path: string,
  input: { content: string; baseHash: string | null },
): Promise<MutationOutcome<PutManagedFileResult>> {
  return mutate(
    '/api/files/instructions/' + path.split('/').map(encodeURIComponent).join('/'),
    'PUT',
    input,
  );
}

/* Packs */

export async function fetchPacks(): Promise<DashboardPack[]> {
  const res = await fetch('/api/packs');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as DashboardPack[];
}

export async function installPack(input: {
  source: string;
  scope: 'project' | 'global';
}): Promise<MutationOutcome<InstallPackResult>> {
  return mutate('/api/packs/install', 'POST', input);
}

export async function removePack(input: {
  name: string;
  scope: 'project' | 'global';
}): Promise<MutationOutcome<RemovePackResult>> {
  return mutate('/api/packs/remove', 'POST', input);
}

/* Ops jobs */

/**
 * Start an ops job. A 409 here means the same action is already running —
 * surfaced as a thrown error sentence, there is nothing to merge.
 */
export async function startOp(action: OpsAction): Promise<OpsJob> {
  const res = await fetch('/api/ops/' + action, { method: 'POST' });
  if (!res.ok) throw new Error(await errorMessage(res));
  const payload = (await res.json()) as { result: OpsJob };
  return payload.result;
}

export async function fetchOpsJob(jobId: string): Promise<OpsJob> {
  const res = await fetch('/api/ops/' + encodeURIComponent(jobId));
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as OpsJob;
}

export async function fetchOps(): Promise<{ jobs: OpsJob[] }> {
  const res = await fetch('/api/ops');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as { jobs: OpsJob[] };
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

export async function fetchOnboardingChecklist(): Promise<OnboardingChecklist> {
  const res = await fetch('/api/onboarding-checklist');
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as OnboardingChecklist;
}

export async function fetchAudit(limit?: number): Promise<AuditFeedPage> {
  const res = await fetch('/api/audit' + (limit !== undefined ? '?limit=' + limit : ''));
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as AuditFeedPage;
}

export async function fetchEvidencePacketMarkdown(): Promise<string> {
  const res = await fetch('/api/export/evidence-packet?format=markdown');
  if (!res.ok) throw new Error(await errorMessage(res));
  return await res.text();
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
