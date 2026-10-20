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
  sealed?: boolean;
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
  compliance: ComplianceCitation[];
  reproducibility: {
    context_hash: string;
    determinism: 'input-replay';
    algo_version: number;
    replayable: boolean;
  } | null;
  checks: ReceiptCheck[];
  subjects: { name: string; digest: string }[];
}

export interface ComplianceCitation {
  framework_id: string;
  framework_title: string;
  framework_version?: string;
  clause_id: string;
  clause_title: string;
  clause_url?: string;
  gate: string;
  relation: string;
  evidence_strength: 'partial' | 'substantial';
  disclaimer: string;
}

export interface ReceiptFeed {
  generatedAt: string;
  brokenAt: number | null;
  receipts: ReceiptCard[];
}

export type InventoryClass = 'web' | 'prompt' | 'evidence' | 'operation';
export type InventoryOwner = 'you' | 'paqad' | 'shared';
export type DashboardArea =
  | 'pulse'
  | 'approvals'
  | 'trust'
  | 'build'
  | 'graph'
  | 'automation'
  | 'knowledge'
  | 'setup'
  | 'site-map';

export interface InventoryItemState {
  exists: boolean;
  detail: string;
  count?: number;
}

export interface InventoryItem {
  key: string;
  name: string;
  why: string;
  class: InventoryClass;
  managedBy: InventoryOwner;
  area: DashboardArea;
  route: string;
  source: string;
  state: InventoryItemState;
}

export interface InventoryReport {
  schemaVersion: 1;
  generatedAt: string;
  items: InventoryItem[];
}

export type SavedViewArea = 'graph' | 'trust' | 'export';

export interface SavedView {
  id: string;
  name: string;
  area: SavedViewArea;
  scope: Record<string, unknown>;
  createdAt: string;
}

export type MaintenanceMode = 'auto' | 'manual';

export interface ResolvedDeliveryTicket {
  maintained: MaintenanceMode;
  provider: 'jira' | 'linear' | 'github-issues' | 'generic';
  server: string;
  require_ticket: boolean;
  write_back_refined: 'never' | 'ask' | 'always';
  comment_decisions: boolean;
}

export interface ResolvedDeliveryHost {
  maintained: MaintenanceMode;
  provider: 'github' | 'gitlab' | 'bitbucket';
  server: string;
}

export interface ResolvedDeliveryBranch {
  maintained: MaintenanceMode;
  template: string;
  type_map: Record<string, string>;
  slug_max_length: number;
  base: string;
}

export interface ResolvedDeliveryCommit {
  maintained: MaintenanceMode;
  template: string;
  sign_off: boolean;
}

export interface ResolvedDeliveryPr {
  maintained: MaintenanceMode;
  title_template: string;
  body_template_path: string;
  base: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  link_ticket: boolean;
  transition_on_open: string;
}

export interface ResolvedDeliveryCi {
  maintained: MaintenanceMode;
  gate: 'wait_for_green' | 'warn_only' | 'off';
  timeout_minutes: number;
  on_red: 'stop' | 'comment_and_stop';
  transition_on_green: string;
}

export interface ResolvedDeliveryIntakeDecisions {
  maintained: MaintenanceMode;
  auto_resolve_from_priors: boolean;
  auto_resolve_from_rules: boolean;
  confirm_auto_resolutions: 'always' | 'batched' | 'never';
  max_options_per_packet: number;
  fingerprint_scope: string[];
}

export interface ResolvedDeliveryProcess {
  ticket: ResolvedDeliveryTicket;
  host: ResolvedDeliveryHost;
  branch: ResolvedDeliveryBranch;
  commit: ResolvedDeliveryCommit;
  pr: ResolvedDeliveryPr;
  ci: ResolvedDeliveryCi;
  intake_decisions: ResolvedDeliveryIntakeDecisions;
}

export interface ResolvedDeliveryPolicy {
  enabled: boolean;
  process: ResolvedDeliveryProcess;
}

export type DeliverySectionKey = keyof ResolvedDeliveryProcess;

export interface ManagedFileInfo {
  path: string;
  exists: boolean;
  content: string | null;
  hash: string | null;
}

export interface DeliveryPolicyConfigResponse {
  resolved: ResolvedDeliveryPolicy;
  warnings: string[];
  file: ManagedFileInfo;
  defaultsYaml: string;
  schema: Record<string, unknown>;
}

export interface DeliveryPolicyIssue {
  path: string;
  message: string;
}

export type PutDeliveryPolicyOutcome =
  | { status: 'ok'; path: string; hash: string; resolved: ResolvedDeliveryPolicy }
  | { status: 'invalid'; error: string; issues: DeliveryPolicyIssue[] }
  | {
      status: 'conflict';
      error: string;
      conflict: { content: string | null; hash: string | null };
    };

export interface ValidationIssue {
  path: string;
  message: string;
}

export type MutationOutcome<T> =
  | { status: 'ok'; result: T }
  | { status: 'invalid'; error: string; issues: ValidationIssue[] }
  | {
      status: 'conflict';
      error: string;
      conflict: { content: string | null; hash: string | null };
    };

export interface PutManagedFileResult {
  path: string;
  hash: string;
}

export interface ProfileConfigResponse {
  profile: Record<string, unknown> | null;
  schema: Record<string, unknown>;
  capabilities: { available: string[]; active: string[] };
}

export interface PutProfileResult {
  path: string;
  profile: Record<string, unknown>;
}

export interface SetCapabilityResult {
  active: string[];
}

export interface ModuleMapFeature {
  slug: string;
  name: string;
  sources: string[];
}

export interface ModuleMapModule {
  slug: string;
  name: string;
  sources: string[];
  features: ModuleMapFeature[];
}

export interface ModuleMapDriftFinding {
  code: string;
  module_slug: string | null;
  feature_slug: string | null;
  paths: string[];
  detail: string;
}

export interface ModuleMapDrift {
  generated_at: string;
  source_roots: string[];
  findings: ModuleMapDriftFinding[];
  blocked: string | null;
  counts: Record<string, number>;
}

export interface ModuleMapConfigResponse {
  file: ManagedFileInfo;
  modules: ModuleMapModule[];
  drift: ModuleMapDrift | null;
}

export interface PutModuleMapResult {
  path: string;
  hash: string;
  modules: ModuleMapModule[];
}

export interface RagStatus {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  indexPresent: boolean;
  indexAgeDays: number | null;
}

export interface RagConfigResponse {
  intelligence: Record<string, unknown> | null;
  status: RagStatus;
}

export interface PutRagResult {
  path: string;
  intelligence: Record<string, unknown>;
}

export interface DesignTokensConfigResponse {
  file: ManagedFileInfo;
  tokens: Record<string, unknown> | null;
  placeholder: boolean;
  schema: Record<string, unknown>;
}

export interface PutDesignTokensResult {
  path: string;
  hash: string;
  regenerated: string[];
  regenerationError?: string;
}

export interface InstructionsTreeNode {
  path: string;
  name: string;
  type: 'directory' | 'file';
  children?: InstructionsTreeNode[];
}

export interface InstructionsTreeResponse {
  root: string;
  exists: boolean;
  tree: InstructionsTreeNode | null;
}

export interface InstructionsFileResponse extends ManagedFileInfo {
  frontmatter: Record<string, unknown>;
  body: string | null;
}

export type PackSource = 'built-in' | 'global' | 'project';

export interface DashboardPack {
  name: string;
  source: PackSource;
  version: string;
  valid: boolean;
}

export interface InstallPackResult {
  name: string;
  version: string;
  scope: 'global' | 'project';
  root: string;
}

export interface RemovePackResult {
  name: string;
  scope: 'global' | 'project';
  removed: true;
}

export type OpsAction =
  | 'reconcile'
  | 'refresh-rules'
  | 'refresh-context'
  | 'rag-rebuild'
  | 'rag-clear'
  | 'regenerate-docs'
  | 'compliance-check'
  | 'doctor'
  | 'site-map';

export interface SiteMapJourney {
  id: string;
  label: string;
  status: 'proposed' | 'confirmed' | 'locked';
}

export interface OpsJob {
  id: string;
  action: OpsAction;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  progress: string[];
  result: unknown;
  error: string | null;
}

export interface OpsProgressEvent {
  jobId: string;
  action: OpsAction;
  status: OpsJob['status'];
  message: string;
}

export interface OnboardingChecklistStep {
  key: 'connect-agent' | 'first-gate' | 'first-decision' | 'first-receipt' | 'edit-instruction';
  label: string;
  route: string;
  done: boolean;
  detail: string;
}

export interface OnboardingChecklist {
  steps: OnboardingChecklistStep[];
  complete: boolean;
  receiptAvailable: boolean;
}

export interface AuditFeedEntry {
  ts: string | null;
  level: string | null;
  action: string | null;
  actor: string | null;
  raw: string;
}

export interface AuditFeedPage {
  entries: AuditFeedEntry[];
  nextCursor: number | null;
  total: number;
}

export interface AiBomResponse {
  generatedAt: string;
  document: {
    bomFormat: string;
    specVersion: string;
    serialNumber: string;
    metadata: { timestamp: string; properties: { name: string; value: string }[] };
    components: {
      type: string;
      name: string;
      hashes?: { alg: string; content: string }[];
    }[];
    properties: { name: string; value: string }[];
  } | null;
}
