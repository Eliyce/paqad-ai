// Codebase-health workflow types (issue #355). Deliberately separate from the
// framework self-health checker in `src/core/types/health.ts` (HealthReport et al.):
// this is the on-demand project audit — dead code, unused/risky deps, secrets,
// stale docs, and AI slop — modelled on the pentest finding/retest/report shapes.

export const HEALTH_WORKFLOWS = ['codebase-health', 'health-retest'] as const;
export type HealthWorkflowName = (typeof HEALTH_WORKFLOWS)[number];

export const HEALTH_SEVERITIES = ['high', 'medium', 'low'] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

/** The six kinds of junk, expressed as eight machine categories. */
export const HEALTH_CATEGORIES = [
  'unused-dependency',
  'vulnerable-dependency',
  'deprecated-dependency',
  'secret-leak',
  'dead-code',
  'duplication',
  'stale-doc',
  'ai-slop',
] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

/** Whether a finding was mechanically proven or is a candidate the AI must judge. */
export const HEALTH_TIERS = ['deterministic', 'ai-judged'] as const;
export type HealthTier = (typeof HEALTH_TIERS)[number];

export const HEALTH_SUGGESTION_ACTIONS = [
  'remove',
  'update',
  'reuse',
  'rotate',
  'rewrite',
] as const;
export type HealthSuggestionAction = (typeof HEALTH_SUGGESTION_ACTIONS)[number];

export const HEALTH_BASELINE_STATUSES = ['new-since-baseline', 'pre-existing', 'unknown'] as const;
export type HealthBaselineStatus = (typeof HEALTH_BASELINE_STATUSES)[number];

export const HEALTH_RETEST_STATUSES = [
  'fixed',
  'still-open',
  'needs-manual-verification',
] as const;
export type HealthRetestStatus = (typeof HEALTH_RETEST_STATUSES)[number];

export const HEALTH_FINDING_STATUSES = [
  'open',
  'fixed',
  'still-open',
  'needs-manual-verification',
] as const;
export type HealthFindingStatus = (typeof HEALTH_FINDING_STATUSES)[number];

export const HEALTH_RUN_STEP_STATUSES = [
  'not_started',
  'running',
  'completed',
  'blocked',
  'failed',
] as const;
export type HealthRunStepStatus = (typeof HEALTH_RUN_STEP_STATUSES)[number];

export const HEALTH_RUN_STATUSES = ['running', 'completed', 'blocked', 'failed'] as const;
export type HealthRunStatus = (typeof HEALTH_RUN_STATUSES)[number];

/** What to do about a finding — the plain-words next action. */
export interface HealthSuggestion {
  action: HealthSuggestionAction;
  detail: string;
}

export interface HealthFinding {
  id: string;
  title: string;
  /** The reason it matters, in plain words. */
  description: string;
  category: HealthCategory;
  severity: HealthSeverity;
  tier: HealthTier;
  /** 0..1 — deterministic findings sit high; ai-judged carry the model's grade. */
  confidence: number;
  /** Proof: tool/source + machine-readable location + a copy-paste reproduce command. */
  evidence: string[];
  suggestion: HealthSuggestion;
  affected_files: string[];
  affected_packages: string[];
  /** True when the check needs the network (deprecation registry, EOL data). */
  requires_network: boolean;
  baseline_status: HealthBaselineStatus;
  status: HealthFindingStatus;
}

export interface HealthRetestFinding extends HealthFinding {
  retest_status: HealthRetestStatus;
}

/** A category (or sub-check) that could not run, with an actionable hint. */
export interface HealthBlockedCheck {
  check: string;
  reason: string;
  install_hint: string;
}

/** Availability of an external scanner and which categories it powers. */
export interface HealthToolStatus {
  tool: string;
  available: boolean;
  used_for: HealthCategory[];
}

export interface HealthBaselineSummary {
  existed: boolean;
  new_since_baseline: number;
  pre_existing: number;
}

export interface HealthReportIndex {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  report_id: string;
  workflow: HealthWorkflowName;
  generated_at: string;
  report_path: string;
  sidecar_path: string;
  source_report_path: string | null;
  source_report_id: string | null;
  offline: boolean;
  stack: {
    primary: string;
    traits: string[];
    toolchains: string[];
  };
  tool_availability: HealthToolStatus[];
  findings: Array<HealthFinding | HealthRetestFinding>;
  blocked_checks: HealthBlockedCheck[];
  baseline: HealthBaselineSummary;
  sources_used: string[];
  next_remediation_priorities: string[];
  raw_evidence_paths: string[];
}

/** Persisted first-run fingerprint set that powers the new-vs-pre-existing ratchet. */
export interface HealthBaseline {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  created_at: string;
  finding_ids: string[];
}

export interface HealthRunStep {
  id: string;
  title: string;
  status: HealthRunStepStatus;
  input_hash: string | null;
  artifact_paths: string[];
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface HealthRunProgress {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  run_id: string;
  workflow: HealthWorkflowName;
  status: HealthRunStatus;
  started_at: string;
  updated_at: string;
  report_path: string | null;
  sidecar_path: string | null;
  offline: boolean;
  source_report_path: string | null;
  steps: HealthRunStep[];
  script_artifacts: string[];
  current_finding_ids: string[];
}
