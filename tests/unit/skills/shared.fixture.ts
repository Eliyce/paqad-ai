import type { ClassificationResult } from '@/core/types/classification.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';

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
    complexity: 'medium',
    risk: 'medium',
    scope: 'single-module',
    affected_modules: ['billing'],
    process_depth: 'graduated lane',
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

export function fixtureResolvedArtifact(path: string): ResolvedArtifact {
  return {
    path,
    level: 2,
    source: path,
  };
}
