import type { ResolutionMap, ResolutionSource } from '@/core/types/classification.js';

const WEIGHTS: Record<string, number> = {
  deterministic: 1,
  'deterministic:mcp': 1,
  'deterministic:rag': 1,
  'deterministic:graph': 1,
  'deterministic:manifest': 1,
  'llm-confirmed': 0.8,
  'llm-overridden': 0.6,
  'llm-guessed': 0.3,
  'health-override': 1,
  'history-corrected': 1,
  'defect-floor': 1,
  default: 0.1,
};

/**
 * Total number of classification dimensions that can appear in a ResolutionMap.
 * Used as the denominator in the confidence formula so that unresolved dimensions
 * contribute 0, reducing overall confidence rather than being ignored.
 *
 * Dimensions: workflow, affected_modules, scope, database_impact, api_impact,
 * ui_impact, compliance_sensitivity, customer_facing_impact, reversibility,
 * data_sensitivity, delta_candidate, context_budget_hint, matched_rule_triggers,
 * complexity, risk = 15 total.
 */
const TOTAL_CLASSIFICATION_DIMENSIONS = 15;

export function computeClassificationConfidence(resolutionMap: ResolutionMap): number {
  const entries = Object.values(resolutionMap).filter(
    (value): value is ResolutionSource => value !== undefined,
  );
  if (entries.length === 0) {
    return 0;
  }

  const weighted = entries.reduce((sum, source) => sum + (WEIGHTS[source] ?? 0.1), 0);
  return Math.min(1, Math.round((weighted / TOTAL_CLASSIFICATION_DIMENSIONS) * 100) / 100);
}
