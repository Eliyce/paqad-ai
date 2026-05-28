export const REQUIREMENT_PRIORITIES = ['must', 'should', 'could'] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const REQUIREMENT_RISKS = ['low', 'medium', 'high'] as const;
export type RequirementRisk = (typeof REQUIREMENT_RISKS)[number];

export type RequirementType = 'functional' | 'non-functional' | 'constraint' | 'edge-case';
export type ProofType = 'automated' | 'manual' | 'visual';
export type CriterionStatus = 'uncovered' | 'covered' | 'partial' | 'indeterminate';
export type HealthTier = 'stable' | 'moderate' | 'fragile' | 'unknown';
export type RollbackClass = 'safe' | 'needs-migration' | 'destructive';
export type PlanMode = 'full' | 'delta';
export type PlanningLane = 'fast' | 'graduated' | 'full';
export type SliceExecutionStatus =
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'escalated'
  | 'blocked';
export type SliceEscalationReason = 'retry_failed' | 'circuit_breaker' | 'protected_scope';
export type ExecutionTrackerStatus =
  | 'not-started'
  | 'in-progress'
  | 'completed'
  | 'partial'
  | 'failed';
export type CriterionSource =
  | 'planned'
  | 'compiled-rule'
  | 'defect-pattern'
  | 'contract-boundary'
  | 'inherited';
export type DocTargetStatus = 'pending' | 'updated' | 'skipped';
export type RegressionStatus = 'pending' | 'passing' | 'failing';
export type ManifestComplexity = 'trivial' | 'low' | 'medium' | 'high' | 'very-high';
export type ManifestRisk = 'low' | 'medium' | 'high';

export interface RequirementNode {
  id: string;
  type: RequirementType;
  description: string;
  depends_on: string[];
  scope: string[];
  risk: RequirementRisk;
  source_refs?: string[];
  priority?: RequirementPriority;
}

export interface ExecutionSlice {
  slice_id: string;
  goal: string;
  covers: string[];
  depends_on: string[];
  touches: string[];
  preconditions?: string[];
  rollback_class?: RollbackClass;
  token_budget?: number;
}

export interface VerificationCase {
  input: string;
  expected_behavior: string;
}

export interface VerificationCriterion {
  criterion_id: string;
  given: string;
  when: string;
  then: string;
  proof_type: ProofType;
  proof_target?: string;
  negative_cases?: VerificationCase[];
  edge_cases?: VerificationCase[];
  adversarial_cases?: VerificationCase[];
  status: CriterionStatus;
  source: CriterionSource;
  linked_requirement_ids: string[];
  rule_id?: string;
  pattern_id?: string;
}

export interface RejectedAlternative {
  alternative: string;
  rejection_reason: string;
}

export interface DecisionRecord {
  decision_id: string;
  choice: string;
  reason: string;
  alternatives_rejected: RejectedAlternative[];
  linked_requirements: string[];
  reversibility: 'easy' | 'moderate' | 'hard';
}

export interface DocTarget {
  target_id: string;
  file: string;
  section: string;
  reason: string;
  slice_id: string;
  status: DocTargetStatus;
}

export interface RegressionEntry {
  entry_id: string;
  test_file: string;
  test_name?: string;
  touched_file: string;
  slice_id: string;
  obligation_id?: string;
  status: RegressionStatus;
}

export interface ManifestClassification {
  workflow: string;
  complexity: ManifestComplexity;
  risk: ManifestRisk;
  lane: PlanningLane;
  domain: string | null;
  stack: string;
  scope?: string;
  affected_modules: string[];
  affected_module_count?: number;
  api_impact?: string | null;
  ui_impact?: string | null;
}

export interface RequirementGraphDelta<T> {
  added: T[];
  changed: Array<{
    id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }>;
  removed: T[];
}

export interface ManifestDelta {
  requirement_graph: RequirementGraphDelta<RequirementNode>;
  execution_slices: RequirementGraphDelta<ExecutionSlice>;
  verification_matrix: RequirementGraphDelta<VerificationCriterion>;
  decision_log: {
    added: DecisionRecord[];
  };
}

export interface PlanningManifest {
  plan_version: number;
  plan_mode: PlanMode;
  feature_id: string;
  slug: string;
  created_at: string;
  base_manifest_hash: string | null;
  classification: ManifestClassification;
  requirement_graph: RequirementNode[];
  execution_slices: ExecutionSlice[];
  verification_matrix: VerificationCriterion[];
  decision_log: DecisionRecord[];
  doc_targets: DocTarget[];
  regression_watch: RegressionEntry[];
  changes?: ManifestDelta;
}

export interface SliceBudgetSummary {
  total: number;
  per_slice_base: number;
  per_slice_with_buffer: number;
  consumed: number;
  remaining: number;
}

export interface SliceProgressEntry {
  status: SliceExecutionStatus;
  started_at?: string | null;
  completed_at?: string | null;
  attempt?: number;
  tokens_used?: number | null;
  tests_passed?: number | null;
  tests_failed?: number | null;
  docs_updated?: number | null;
  scope_clean?: boolean | null;
}

export interface ExecutionProgressTracker {
  slug: string;
  started_at: string;
  updated_at: string;
  total_slices: number;
  status: ExecutionTrackerStatus;
  slices: Record<string, SliceProgressEntry>;
  token_budget: SliceBudgetSummary;
  baseline_failing_tests?: string[];
  re_planned_slices?: string[];
}

export interface SliceCheckpoint {
  slice_id: string;
  goal: string;
  status: 'completed' | 'failed' | 'escalated';
  attempt: number;
  started_at: string;
  completed_at: string;
  tokens_used: number;
  files_changed: string[];
  exports_created: string[];
  decisions_made: Array<{
    decision_id: string;
    choice: string;
    linked_requirements: string[];
  }>;
  criteria_results: Record<string, CriterionStatus>;
  doc_targets_updated: string[];
  regression_results: Record<string, RegressionStatus>;
  gate_result: SliceGateResult;
  compression_stats: {
    raw_context_tokens: number;
    summary_tokens: number;
    compression_ratio: number;
  };
}

export interface PriorSliceSummary {
  slice_id: string;
  goal: string;
  status: 'completed' | 'failed' | 'escalated';
  files_changed: string[];
  exports_available: string[];
}

export interface SliceFailingTest {
  test_file: string;
  test_name?: string;
  error: string;
}

export interface SliceFixAttempt {
  attempt: number;
  change_summary: string;
  result: string;
}

export interface SliceEscalationReport {
  slice_id: string;
  escalation_reason: SliceEscalationReason;
  attempts: number;
  failing_criteria: string[];
  failing_tests: SliceFailingTest[];
  scope_violations: SliceScopeViolation[];
  regression_failures: string[];
  fix_attempts: SliceFixAttempt[];
  tokens_consumed: number;
  recommendation: string;
  blocked_downstream: string[];
}

export interface SliceCriteriaCheck {
  criterion_id: string;
  status: CriterionStatus;
  proof_target?: string;
  passed: boolean;
  detail: string;
}

export interface SliceScopeViolation {
  file: string;
  type: 'future-slice' | 'prior-slice' | 'outside-manifest' | 'protected-file';
  severity: 'warning' | 'error';
}

export interface SliceScopeCheck {
  status: 'clean' | 'warning' | 'violation';
  modified_files: string[];
  violations: SliceScopeViolation[];
}

export interface SliceDocCheck {
  target_id: string;
  status: DocTargetStatus;
  changed: boolean;
}

export interface SliceRegressionCheck {
  entry_id: string;
  status: RegressionStatus;
  passed: boolean;
  detail: string;
}

export interface SliceFullSuiteCheck {
  total_tests: number;
  passing: number;
  failing: number;
  new_failures: string[];
  pre_existing_failures: string[];
  duration_ms: number;
  slow_suite_warning: boolean;
}

export interface SliceGateResult {
  status: 'pass' | 'fail';
  criteria: {
    total: number;
    covered: number;
    uncovered: number;
  };
  scope: SliceScopeCheck;
  docs: {
    total: number;
    updated: number;
    skipped: number;
  };
  regression: {
    total: number;
    passing: number;
    failing: number;
  };
  decision: {
    total: number;
    passing: number;
    failing: number;
  };
  full_suite: SliceFullSuiteCheck;
  warnings: string[];
}

export interface SliceContext {
  manifest_header: Pick<
    PlanningManifest,
    'plan_version' | 'plan_mode' | 'feature_id' | 'slug' | 'created_at' | 'classification'
  >;
  current_slice: ExecutionSlice;
  verification_criteria: VerificationCriterion[];
  test_skeletons: string[];
  doc_targets: DocTarget[];
  regression_entries: RegressionEntry[];
  prior_slices: PriorSliceSummary[];
  existing_code_matches: ExistingImplementation[];
  decision_context: DecisionRecord[];
  decision_packets?: import('@/planning/decision-packet.js').DecisionPacket[];
  token_budget: number;
}

export interface ModuleHealthMetrics {
  coverage_pct?: number | null;
  defect_frequency?: number | null;
  contract_stability?: number | null;
  change_velocity?: number | null;
  // Issue #80, Phase 3 — test-driven rollup adds raw counts alongside the
  // existing coverage / stability fields. Null when the rollup ran but the
  // parser produced no signal for the module; populated in `blocked_metrics`
  // with a reason when the rollup was unable to compute the value at all.
  tests_passing?: number | null;
  tests_failing?: number | null;
  tests_total?: number | null;
}

export interface ModuleHealthProfile {
  schema_version?: number;
  module: string;
  tier: HealthTier;
  metrics: ModuleHealthMetrics;
  // Issue #80, Phase 3 — populated by the rollup runner. Each entry names a
  // metric that could not be computed plus the reason (e.g.
  // `contract_stability: no_public_api_extractor`). No metric is fabricated
  // or zeroed when a signal is missing; it is set to null and the reason
  // recorded here.
  blocked_metrics?: string[];
  evidence?: {
    last_event_id?: string;
    last_provider?: string;
    last_session_id?: string;
    last_verification_status?: 'pass' | 'fail' | 'partial' | 'unknown';
    last_changed_files?: string[];
    processed_event_ids?: string[];
    // Phase 3 rollup adds a structured snapshot of the inputs that produced
    // the current metrics. Optional so existing planning-evidence consumers
    // keep working unchanged.
    rollup?: {
      coverage_format?: string;
      coverage_path?: string;
      test_report_format?: string;
      test_report_path?: string;
      git_window_days?: number;
      ran_at?: string;
      source?: 'rollup' | 'from-report';
    };
  };
  history?: {
    lookback_days?: number;
    events_count?: number;
    last_failure_at?: string | null;
    last_success_at?: string | null;
  };
  updated_at: string;
}

export interface CompiledRule {
  rule_id: string;
  title: string;
  source_path: string;
  trigger_patterns: string[];
  severity: RequirementPriority;
  summary: string;
  raw_text?: string;
}

export interface CompiledRulesStore {
  schema_version: number;
  generated_at: string;
  source_hash: string;
  rules: CompiledRule[];
}

export interface CoverageOverlayEntry {
  criterion_id: string;
  status: CriterionStatus;
  evidence_files: string[];
}

export interface DefectPatternSummary {
  pattern_id: string;
  subcategory: string;
  description: string;
  frequency: number;
}

export interface ExistingImplementation {
  file_path: string;
  function_name: string;
  description: string;
  relevance_score: number;
}

export interface IntelligenceContext {
  module_health: ModuleHealthProfile[];
  compiled_rules: CompiledRulesStore | null;
  inherited_constraints: string[];
  coverage_overlay: CoverageOverlayEntry[];
  defect_patterns: DefectPatternSummary[];
  selective_docs: Array<{ path: string; content: string }>;
  existing_implementations: ExistingImplementation[];
  predicted_tokens: number;
}

export interface PlanningCostEntry {
  slug: string;
  timestamp: string;
  classification: Pick<
    ManifestClassification,
    'complexity' | 'risk' | 'lane' | 'scope' | 'affected_module_count'
  >;
  predicted_tokens: number;
  actual_tokens: number;
  slice_count: number;
  criterion_count: number;
  auto_injected_count: number;
}

export interface PlanningCostLog {
  entries: PlanningCostEntry[];
}

export interface PlanVsActualSnapshot {
  changed_files: string[];
  used_files?: string[];
  covered_criteria?: string[];
}

export interface PlanVsActualDiff {
  scope_accuracy_pct: number;
  criteria_pass_rate_pct: number;
  unplanned_files: string[];
  planned_but_unused_files: string[];
  uncovered_criteria: string[];
}
