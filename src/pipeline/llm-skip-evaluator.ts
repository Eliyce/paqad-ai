import type { ClassificationWorkflow, ResolutionMap } from '@/core/types/classification.js';
import type { PreClassificationResult } from '@/core/types/pre-classification.js';

const FAST_LANE_WORKFLOWS = new Set<ClassificationWorkflow>([
  'bug-fix',
  'cleanup',
  'documentation-update',
  'editing',
  'investigation',
  'planning',
  'project-question',
  'research',
  'test-improvement',
  'writing',
]);

export function shouldSkipLlm(
  preResult: PreClassificationResult,
  confidence: number,
  requestText: string,
  resolutionMap: ResolutionMap,
): boolean {
  const normalized = requestText.toLowerCase();
  if (normalized.includes('?') || normalized.includes('maybe') || normalized.includes('possibly')) {
    return false;
  }

  const workflow = preResult.resolved.workflow ?? null;
  const modulesSource = preResult.resolved.affected_modules_source ?? '';
  const scopeSource = resolutionMap.scope;
  const impactsResolved =
    resolutionMap.database_impact !== undefined &&
    resolutionMap.api_impact !== undefined &&
    resolutionMap.ui_impact !== undefined;
  const ruleTriggers = preResult.resolved.matched_rule_triggers ?? [];
  const sensitiveTriggers = ruleTriggers.some((trigger) =>
    /(security|auth|compliance|privacy|payment|gdpr|secret)/i.test(trigger),
  );

  return (
    confidence >= 0.85 &&
    resolutionMap.workflow === 'deterministic' &&
    /explicit-path|symbol-index/.test(modulesSource) &&
    scopeSource === 'deterministic:graph' &&
    impactsResolved &&
    workflow !== null &&
    FAST_LANE_WORKFLOWS.has(workflow) &&
    !sensitiveTriggers &&
    preResult.resolved.delta_candidate !== true
  );
}
