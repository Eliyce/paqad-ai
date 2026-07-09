/**
 * The 9 routing outcomes (issue #336).
 *
 * Every user message routes to exactly one of these. This is the reroute layer
 * (decision D-01KX3ER3BQW3RP6FBRYQK31RS8): the fine-grained `ClassificationWorkflow`
 * union and its internal behaviour/lane/budget/retrieval sets are left intact; only
 * the routing OUTCOME — what drives evidence, per-session state, RAG scope, and lane
 * gating — collapses to these 9. Mechanically the outcome matters as a three-way
 * split: `feature-development` (rules + lane + rule-scripts + code-scope RAG) vs a
 * real non-code workflow (no rules, no lane, no rule-scripts, docs-scope RAG) vs
 * `no-workflow` (nothing, no RAG).
 *
 * `pentest-retest`, `design-retest`, and `rules-generate` are backing sub-modes of
 * their parent outcome, not separate outcomes.
 */
import type { ClassificationWorkflow } from '@/core/types/classification.js';

export const ROUTED_WORKFLOWS = [
  'feature-development',
  'project-question',
  'documentation-update',
  'module-documentation',
  'pentest',
  'design-test',
  'rules-analyze',
  'root-cause-analysis',
  'no-workflow',
] as const;
export type RoutedWorkflow = (typeof ROUTED_WORKFLOWS)[number];

/**
 * Whether an outcome loads rules, a lane, and rule-scripts (the heavy path). Only
 * `feature-development` does; everything else is lighter. Callers gate the lane
 * seam, the rule-script capability, and rule injection on this.
 */
export function isFeatureDevelopmentRoute(routed: RoutedWorkflow): boolean {
  return routed === 'feature-development';
}

/**
 * Whether an outcome retrieves from the RAG index. Every real workflow does (when
 * `rag_enabled`); only `no-workflow` retrieves nothing.
 */
export function routeUsesRetrieval(routed: RoutedWorkflow): boolean {
  return routed !== 'no-workflow';
}

/**
 * Map a fine-grained {@link ClassificationWorkflow} (or `null`/`undefined`) to
 * exactly one of the 9 {@link ROUTED_WORKFLOWS} outcomes. Code-change intents fold
 * into `feature-development`; read-and-understand intents into `project-question`;
 * the named workflows to themselves; generic content and small talk (and an absent
 * classification) into `no-workflow`. The map is exhaustive over the union so a new
 * union member is a compile error here until it is given an outcome.
 */
const OUTCOME_BY_WORKFLOW: Record<ClassificationWorkflow, RoutedWorkflow> = {
  // Code changes → feature-development (the only route that loads rules + lane + scripts).
  'feature-development': 'feature-development',
  'bug-fix': 'feature-development',
  refactor: 'feature-development',
  migration: 'feature-development',
  cleanup: 'feature-development',
  'architecture-change': 'feature-development',
  'test-improvement': 'feature-development',
  'schema-change': 'feature-development',
  'query-optimization': 'feature-development',
  // Read-and-understand, no code change → project-question.
  'project-question': 'project-question',
  investigation: 'project-question',
  'ticket-refinement': 'project-question',
  // Named non-code workflows map to themselves.
  'documentation-update': 'documentation-update',
  'module-documentation': 'module-documentation',
  pentest: 'pentest',
  'pentest-retest': 'pentest',
  'root-cause-analysis': 'root-cause-analysis',
  // Generic content and anything not one of the above → no-workflow (no rules/lane/scripts/RAG).
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
