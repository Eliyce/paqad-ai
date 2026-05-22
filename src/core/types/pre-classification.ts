import type {
  ApiImpact,
  ClassificationScope,
  ClassificationWorkflow,
  ComplianceSensitivity,
  ContextBudgetHint,
  CustomerFacingImpact,
  DataSensitivity,
  DatabaseImpact,
  ResolutionMap,
  Reversibility,
  UiImpact,
} from './classification.js';
import type { DecisionCategory } from '@/planning/decision-packet.js';

export interface AffectedModule {
  path: string;
  source: 'explicit-path' | 'symbol-index' | 'rag' | 'stack-heuristic' | 'mcp' | 'import-graph';
  confidence: number;
}

export interface ClassificationHint<TValue> {
  value: TValue;
  source: string;
  confidence: number;
  reason?: string;
}

export interface PreClassificationResolved {
  workflow?: ClassificationWorkflow | null;
  scope?: ClassificationScope;
  affected_modules?: string[];
  database_impact?: DatabaseImpact;
  api_impact?: ApiImpact;
  ui_impact?: UiImpact;
  compliance_sensitivity?: ComplianceSensitivity;
  customer_facing_impact?: CustomerFacingImpact;
  reversibility?: Reversibility;
  data_sensitivity?: DataSensitivity;
  delta_candidate?: boolean;
  base_manifest_slug?: string | null;
  prior_requirement_count?: number | null;
  prior_criterion_count?: number | null;
  context_budget_hint?: ContextBudgetHint;
  affected_modules_source?: string;
  scope_graph_depth?: number;
  matched_rule_triggers?: string[];
  decision_category?: DecisionCategory;
}

export interface PreClassificationResult {
  resolved: PreClassificationResolved;
  hints: Partial<Record<keyof PreClassificationResolved, ClassificationHint<unknown>>>;
  unresolved: string[];
  resolution_map: ResolutionMap;
  evidence: string[];
  detected_forks?: Array<{
    category: DecisionCategory;
    confidence: number;
    signal: string;
    matched_text: string;
  }>;
}
