import type { ClassificationWorkflow } from '@/core/types/classification.js';
import type { FeatureChangeKind } from '@/feature-evidence/types.js';

export const ROUTED_WORKFLOWS = [
  'feature-development',
  'project-question',
  'documentation-update',
  'module-documentation',
  'pentest',
  'design-test',
  'codebase-health',
  'site-map',
  'rules-analyze',
  'root-cause-analysis',
  'discovery',
  'rules-discovery',
  'onboarding',
  'no-workflow',
] as const;
export type RoutedWorkflow = (typeof ROUTED_WORKFLOWS)[number];

export function isFeatureDevelopmentRoute(routed: RoutedWorkflow): boolean {
  return routed === 'feature-development';
}

export function routeUsesRetrieval(routed: RoutedWorkflow): boolean {
  return routed !== 'no-workflow';
}

const OUTCOME_BY_WORKFLOW: Record<ClassificationWorkflow, RoutedWorkflow> = {
  'feature-development': 'feature-development',
  'bug-fix': 'feature-development',
  refactor: 'feature-development',
  migration: 'feature-development',
  cleanup: 'feature-development',
  'architecture-change': 'feature-development',
  'test-improvement': 'feature-development',
  'schema-change': 'feature-development',
  'query-optimization': 'feature-development',
  'project-question': 'project-question',
  investigation: 'project-question',
  'ticket-refinement': 'project-question',
  'documentation-update': 'documentation-update',
  'module-documentation': 'module-documentation',
  pentest: 'pentest',
  'pentest-retest': 'pentest',
  'codebase-health': 'codebase-health',
  'health-retest': 'codebase-health',
  'site-map': 'site-map',
  'site-map-retest': 'site-map',
  'design-test': 'design-test',
  'design-retest': 'design-test',
  'rules-analyze': 'rules-analyze',
  'rules-generate': 'rules-analyze',
  'root-cause-analysis': 'root-cause-analysis',
  discovery: 'discovery',
  'rules-discovery': 'rules-discovery',
  onboarding: 'onboarding',
  writing: 'no-workflow',
  editing: 'no-workflow',
  planning: 'no-workflow',
  research: 'no-workflow',
  'content-update': 'no-workflow',
  custom: 'no-workflow',
};

export function resolveRoutedWorkflow(
  workflow: ClassificationWorkflow | null | undefined,
): RoutedWorkflow {
  if (!workflow) {
    return 'no-workflow';
  }
  return OUTCOME_BY_WORKFLOW[workflow];
}

const FOLDED_UNDER_ONBOARDING: ReadonlySet<RoutedWorkflow> = new Set([
  'documentation-update',
  'module-documentation',
  'rules-discovery',
  'rules-analyze',
]);

export function routeWhileOnboarding(routed: RoutedWorkflow, journeyOpen: boolean): RoutedWorkflow {
  return journeyOpen && FOLDED_UNDER_ONBOARDING.has(routed) ? 'onboarding' : routed;
}

export function changeKindForWorkflow(
  workflow: ClassificationWorkflow | null | undefined,
): FeatureChangeKind {
  return workflow === 'bug-fix' ? 'fix' : 'other';
}
