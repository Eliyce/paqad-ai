export const TOKEN_ARTIFACT_CLASSES = [
  'test-output',
  'coverage-output',
  'json-report',
  'xml-report',
  'log-output',
  'grep-results',
  'route-dump',
  'inventory-scan-output',
] as const;
export type TokenArtifactClass = (typeof TOKEN_ARTIFACT_CLASSES)[number];

export const ESCALATION_REASONS = [
  'structured-parse-failed-or-degraded',
  'summary-confidence-low',
  'compact-signals-contradict',
  'diagnosis-unresolved-after-compact-pass',
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export interface TokenEfficiencyMetadata {
  original_size: number;
  compact_size: number;
  reduction_ratio: number;
  delta_mode_used: boolean;
  escalation_occurred: boolean;
}

export interface CompactArtifactSummary {
  summary_counts: Record<string, number>;
  top_failures_or_errors: string[];
  affected_files: string[];
  severity_or_status: string;
  next_recommended_actions: string[];
}

export interface CompactArtifactResult {
  artifact_class: TokenArtifactClass;
  summary: CompactArtifactSummary;
  targeted_excerpts: string[];
  confidence: number;
  raw_artifact_path: string | null;
  metadata: TokenEfficiencyMetadata;
}

export interface BuildCompactArtifactInput {
  artifact_class: TokenArtifactClass;
  raw_content: string;
  raw_artifact_path?: string;
  max_excerpts?: number;
}

export interface EscalationDecision {
  should_escalate: boolean;
  reason: EscalationReason | null;
  raw_slice: string | null;
  metadata: TokenEfficiencyMetadata;
}

export interface EvaluateEscalationInput {
  compact: CompactArtifactResult;
  reason?: EscalationReason;
  unresolved_after_compact?: boolean;
  contradiction_detected?: boolean;
  confidence_threshold?: number;
  max_raw_slice_chars?: number;
  slice_hint?: string;
}

export interface ReasoningInputPayload {
  compact_summary: CompactArtifactSummary;
  targeted_excerpts: string[];
  raw_slice: string | null;
  escalation_reason: EscalationReason | null;
  metadata: TokenEfficiencyMetadata;
}

export interface DeltaReasoningPayload<TDelta> {
  delta: TDelta;
  payload: ReasoningInputPayload;
}

export interface TestIssueSnapshot {
  test_id: string;
  message: string;
  status: 'passed' | 'failed' | 'errored';
}

export interface TestDelta {
  newly_failing_tests: string[];
  newly_passing_tests: string[];
  newly_errored_tests: string[];
  changed_failure_messages: Array<{
    test_id: string;
    before: string;
    after: string;
  }>;
}

export interface VerificationGateSnapshot {
  gate: string;
  passed: boolean;
  detail: string;
  remediation?: string;
}

export interface VerificationDelta {
  changed_gate_outcomes: Array<{
    gate: string;
    before_passed: boolean;
    after_passed: boolean;
  }>;
  changed_evidence: Array<{
    gate: string;
    before_detail: string;
    after_detail: string;
  }>;
  changed_recommended_actions: Array<{
    gate: string;
    before: string;
    after: string;
  }>;
}

export interface DriftFileSnapshot {
  file: string;
  status: string;
  conclusion: string;
}

export interface DriftDelta {
  changed_files: string[];
  changed_statuses: Array<{
    file: string;
    before: string;
    after: string;
  }>;
  changed_conclusions: Array<{
    file: string;
    before: string;
    after: string;
  }>;
}

export const DISCLOSURE_LEVELS = ['summary', 'compact', 'excerpt', 'raw'] as const;
export type DisclosureLevel = (typeof DISCLOSURE_LEVELS)[number];

export const DISCLOSURE_ESCALATION_REASONS = [
  'ambiguity-unresolved',
  'previous-layer-insufficient',
  'high-risk-or-cross-cutting',
] as const;
export type DisclosureEscalationReason = (typeof DISCLOSURE_ESCALATION_REASONS)[number];

export interface DisclosurePolicyInput {
  compact: CompactArtifactResult;
  escalation?: EscalationDecision;
  requested_level?: DisclosureLevel;
  escalation_reason?: DisclosureEscalationReason;
}

export interface DisclosureAuditRecord {
  selected_level: DisclosureLevel;
  escalation_occurred: boolean;
  escalation_reason: DisclosureEscalationReason | null;
  skipped_intermediate: boolean;
}

export interface DisclosurePolicyResult {
  level: DisclosureLevel;
  payload: string;
  escalation_reason: DisclosureEscalationReason | null;
  skipped_intermediate: boolean;
  audit: DisclosureAuditRecord;
}

export const TASK_COMPLEXITIES = [
  'trivial',
  'single-file',
  'single-module',
  'cross-cutting',
] as const;
export type TaskComplexity = (typeof TASK_COMPLEXITIES)[number];

export const RETRIEVAL_PATHS = ['direct', 'lexical', 'rag-shallow', 'rag-deep'] as const;
export type RetrievalPath = (typeof RETRIEVAL_PATHS)[number];

export const RETRIEVAL_ESCALATION_SIGNALS = [
  'insufficient-chunks',
  'conflicting-evidence',
  'unresolved-target-file-ambiguity',
] as const;
export type RetrievalEscalationSignal = (typeof RETRIEVAL_ESCALATION_SIGNALS)[number];

export interface RetrievalGateInput {
  task_complexity: TaskComplexity;
  ambiguity_detected?: boolean;
  chunk_count?: number;
  min_chunk_threshold?: number;
  conflicting_evidence?: boolean;
}

export interface RetrievalAuditRecord {
  retrieval_depth: RetrievalPath;
  rag_skipped: boolean;
  escalation_signal: RetrievalEscalationSignal | null;
}

export interface RetrievalGateResult {
  preferred_path: RetrievalPath;
  rag_skipped: boolean;
  escalation_signal: RetrievalEscalationSignal | null;
  audit: RetrievalAuditRecord;
}

export const ROUTING_MECHANISMS = [
  'deterministic-rule',
  'metadata-lookup',
  'cheap-model',
  'reasoning-model',
] as const;
export type RoutingMechanism = (typeof ROUTING_MECHANISMS)[number];

export interface RoutingInput {
  task_type: string;
  target_scope?: string;
  metadata?: Record<string, unknown>;
}

export interface RoutingAuditRecord {
  routing_mechanism: RoutingMechanism;
  resolved_before_reasoning: boolean;
}

export interface RoutingResult {
  needs_reasoning: boolean;
  mechanism_used: RoutingMechanism;
  resolved_task_type: string | null;
  audit: RoutingAuditRecord;
}

export interface ControlLayerAuditRecord {
  disclosure: DisclosureAuditRecord;
  retrieval: RetrievalAuditRecord;
  routing: RoutingAuditRecord;
}
