/**
 * Mirrors the contract in src/dashboard/types.ts. Kept structurally
 * identical so JSON deserialisation just works. Update both sides when
 * adding fields.
 */
export type ScoreBand = 'green' | 'amber' | 'red' | 'unknown';

export interface SectionMetric {
  label: string;
  value: string;
}

export interface SectionData {
  id: string;
  title: string;
  band: ScoreBand;
  score: number | null;
  summary: string;
  metrics: SectionMetric[];
  helper?: { what: string; goodLooksLike: string };
  details?: Record<string, unknown>;
}

export interface AttentionItem {
  sectionId: string;
  message: string;
  severity: 'info' | 'warn' | 'critical';
}

export interface DashboardReport {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  projectName: string | null;
  frameworkVersion: string | null;
  notOnboarded: boolean;
  overallScore: number | null;
  overallBand: ScoreBand;
  attention: AttentionItem[];
  sections: SectionData[];
}

/* Approvals inbox — mirrors src/dashboard/approvals.ts. */

export interface ApprovalsPauseOption {
  option_key: string;
  label: string;
  one_line_preview: string;
  trade_off: string;
}

export interface ApprovalsPauseItem {
  kind: 'pause';
  id: string;
  category: string;
  question: string;
  context: string;
  options: ApprovalsPauseOption[];
  recommendation: string | null;
  recommendation_reason: string | null;
  requested_by: string;
  created_at: string;
  ttl_until: string;
}

export interface ApprovalsProposalItem {
  kind: 'module-proposal';
  id: string;
  proposed_slug: string;
  proposed_name: string;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
  prompt_excerpt: string;
  created_at: string;
  expires_at: string;
}

export interface ApprovalsFeed {
  generatedAt: string;
  pauses: ApprovalsPauseItem[];
  proposals: ApprovalsProposalItem[];
  pendingCount: number;
}

/* Trust area — mirrors src/dashboard/trust.ts. */

export interface EvidenceRow {
  ts: string;
  engine: string;
  code: string;
  subject_digest: string;
  verdict: 'pass' | 'fail' | 'inconclusive' | 'blocked';
  strength_class: 'deterministic' | 'llm-judged' | 'blocked';
  content_hash: string;
  detail?: string;
}

export interface EvidenceFeed {
  generatedAt: string;
  total: number;
  rows: EvidenceRow[];
}

export interface ReceiptCheck {
  code: string;
  engine: string;
  verdict: EvidenceRow['verdict'];
  strength_class: EvidenceRow['strength_class'];
}

export interface ReceiptCard {
  index: number;
  receipt_hash: string;
  prev_receipt_hash: string;
  signing_mode: 'sigstore-keyless' | 'hash-chained';
  sealed: boolean;
  time_verified: string | null;
  verification_result: 'PASSED' | 'FAILED' | null;
  authorship: {
    agent?: string;
    model?: string;
    provider?: string;
    model_id?: string;
    accepting_human?: { name?: string; email?: string };
    provenance: 'declared' | 'unknown';
  } | null;
  checks: ReceiptCheck[];
  subjects: { name: string; digest: string }[];
}

export interface ReceiptFeed {
  generatedAt: string;
  brokenAt: number | null;
  receipts: ReceiptCard[];
}

/* Functionality inventory — mirrors src/dashboard/inventory.ts. */

export type InventoryClass = 'web' | 'prompt' | 'evidence' | 'operation';
export type InventoryOwner = 'you' | 'paqad' | 'shared';
export type DashboardArea =
  | 'pulse'
  | 'approvals'
  | 'trust'
  | 'build'
  | 'automation'
  | 'knowledge'
  | 'setup';

export interface InventoryItemState {
  /** True when the source of truth exists on disk. */
  exists: boolean;
  /** One short sentence describing the live state. */
  detail: string;
  /** Optional count behind the detail (files, entries, pending items). */
  count?: number;
}

export interface InventoryItem {
  key: string;
  name: string;
  why: string;
  class: InventoryClass;
  managedBy: InventoryOwner;
  area: DashboardArea;
  /** Hash route of the area page that renders this item. */
  route: string;
  /** Project-relative source of truth (posix). */
  source: string;
  state: InventoryItemState;
}

export interface InventoryReport {
  schemaVersion: 1;
  generatedAt: string;
  items: InventoryItem[];
}

export interface AiBomResponse {
  generatedAt: string;
  document: {
    bomFormat: string;
    specVersion: string;
    serialNumber: string;
    metadata: { timestamp: string; properties: { name: string; value: string }[] };
    components: { type: string; name: string }[];
    properties: { name: string; value: string }[];
  } | null;
}
