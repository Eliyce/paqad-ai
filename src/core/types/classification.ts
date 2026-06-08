import type { Domain, Stack } from './domain.js';
import type { Complexity, ProcessDepth, Risk, Lane } from './routing.js';

export const CLASSIFICATION_WORKFLOWS = [
  'project-question',
  'ticket-refinement',
  'writing',
  'editing',
  'planning',
  'research',
  'feature-development',
  'bug-fix',
  'refactor',
  'migration',
  'content-update',
  'investigation',
  'cleanup',
  'architecture-change',
  'test-improvement',
  'documentation-update',
  'module-documentation',
  'root-cause-analysis',
  'pentest',
  'pentest-retest',
  'schema-change',
  'query-optimization',
  'custom',
] as const;
export type ClassificationWorkflow = (typeof CLASSIFICATION_WORKFLOWS)[number];

export const CLASSIFICATION_SCOPES = [
  'single-file',
  'single-module',
  'multi-module',
  'system-wide',
] as const;
export type ClassificationScope = (typeof CLASSIFICATION_SCOPES)[number];

export const CLASSIFICATION_CERTAINTY = ['well-defined', 'partially-defined', 'ambiguous'] as const;
export type ClassificationCertainty = (typeof CLASSIFICATION_CERTAINTY)[number];

export const CLASSIFICATION_OUTPUT_TYPES = [
  'code',
  'documentation',
  'analysis',
  'design',
  'report',
] as const;
export type ClassificationOutputType = (typeof CLASSIFICATION_OUTPUT_TYPES)[number];

export const DATABASE_IMPACTS = [
  'none',
  'additive-only',
  'schema-change',
  'data-migration',
  'query-change',
] as const;
export type DatabaseImpact = (typeof DATABASE_IMPACTS)[number];

export const UI_IMPACTS = [
  'none',
  'minor-tweak',
  'new-component',
  'new-screen',
  'redesign',
] as const;
export type UiImpact = (typeof UI_IMPACTS)[number];

export const API_IMPACTS = [
  'none',
  'additive-endpoint',
  'modified-endpoint',
  'breaking-change',
] as const;
export type ApiImpact = (typeof API_IMPACTS)[number];

export const COMPLIANCE_SENSITIVITY_LEVELS = ['none', 'low', 'high'] as const;
export type ComplianceSensitivity = (typeof COMPLIANCE_SENSITIVITY_LEVELS)[number];

export const CUSTOMER_FACING_IMPACTS = ['internal', 'customer-visible'] as const;
export type CustomerFacingImpact = (typeof CUSTOMER_FACING_IMPACTS)[number];

export const REVERSIBILITY_LEVELS = ['easily-reversible', 'difficult', 'irreversible'] as const;
export type Reversibility = (typeof REVERSIBILITY_LEVELS)[number];

export const DATA_SENSITIVITY_LEVELS = ['none', 'pii', 'financial', 'health'] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITY_LEVELS)[number];

export const TARGET_CAPABILITIES = ['content', 'coding', 'security', 'mixed'] as const;
export type TargetCapability = (typeof TARGET_CAPABILITIES)[number];
export const WORKFLOW_SOURCES = ['routing-skill', 'active-session', 'none'] as const;
export type WorkflowSource = (typeof WORKFLOW_SOURCES)[number];

export const RESOLUTION_SOURCES = [
  'deterministic',
  'deterministic:mcp',
  'deterministic:rag',
  'deterministic:graph',
  'deterministic:manifest',
  'llm-confirmed',
  'llm-overridden',
  'llm-guessed',
  'health-override',
  'history-corrected',
  'defect-floor',
  'session-resume',
  'default',
] as const;
export type ResolutionSource = (typeof RESOLUTION_SOURCES)[number];

export const CONTEXT_BUDGET_HINTS = ['minimal', 'standard', 'deep'] as const;
export type ContextBudgetHint = (typeof CONTEXT_BUDGET_HINTS)[number];
export type ResolutionMap = Partial<Record<string, ResolutionSource>>;

export interface ClassificationResult {
  request_text: string;
  domain: Domain;
  stack: Stack;
  target_capability: TargetCapability;
  capability_gap: boolean;
  workflow: ClassificationWorkflow | null;
  custom_workflow_name?: string | null;
  workflow_source: WorkflowSource;
  workflow_reason?: string | null;
  matched_rule?: string | null;
  complexity: Complexity;
  risk: Risk;
  scope: ClassificationScope;
  affected_modules: string[];
  process_depth: ProcessDepth;
  certainty: ClassificationCertainty;
  output_type: ClassificationOutputType;
  database_impact: DatabaseImpact;
  ui_impact: UiImpact;
  api_impact: ApiImpact;
  compliance_sensitivity: ComplianceSensitivity;
  customer_facing_impact: CustomerFacingImpact;
  reversibility: Reversibility;
  data_sensitivity: DataSensitivity;
  classification_confidence?: number;
  resolution_map?: ResolutionMap;
  lane_before_override?: string;
  lane_override_reason?: string | null;
  risk_floor?: Risk | null;
  risk_floor_reason?: string | null;
  complexity_adjustment?: number;
  complexity_adjustment_reason?: string | null;
  delta_candidate?: boolean;
  base_manifest_slug?: string | null;
  prior_requirement_count?: number | null;
  prior_criterion_count?: number | null;
  context_budget_hint?: ContextBudgetHint;
  /**
   * Whether the next turn needs retrieved context folded in (PQD-171). Optional
   * and additive: classifiers that do not yet set it leave it `undefined`, which
   * the conversation rebuild treats as "no retrieval". Mirrors
   * `selectRetrievalDepth() !== 'none'` when a depth router is wired upstream.
   */
  retrieval_needed?: boolean;
  affected_modules_source?: string;
  scope_graph_depth?: number;
  matched_rule_triggers?: string[];
  resumed_from_session?: boolean;
  resume_lane?: Lane | null;
  workflow_continuity_reason?: string | null;
}
