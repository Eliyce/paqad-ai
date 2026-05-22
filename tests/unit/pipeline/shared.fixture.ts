import type { ClassificationResult } from '@/core/types/classification.js';

export function fixtureClassification(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    request_text: 'Build a billing workflow change',
    domain: 'coding',
    stack: 'laravel',
    target_capability: 'coding',
    capability_gap: false,
    workflow: 'feature-development',
    custom_workflow_name: null,
    workflow_source: 'routing-skill',
    workflow_reason: 'Matched workflow-router rule "build".',
    matched_rule: 'build',
    complexity: 'high',
    risk: 'high',
    scope: 'system-wide',
    affected_modules: ['billing'],
    process_depth: 'full lane',
    certainty: 'well-defined',
    output_type: 'code',
    database_impact: 'none',
    ui_impact: 'none',
    api_impact: 'none',
    compliance_sensitivity: 'none',
    customer_facing_impact: 'internal',
    reversibility: 'easily-reversible',
    data_sensitivity: 'none',
    ...overrides,
  };
}
