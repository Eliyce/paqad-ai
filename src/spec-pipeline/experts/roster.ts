// The expert roster (issue #521, Phase 2 — FR-1 / INV-3; extended by issue #558).
//
// The roster is the EXPERT SUBSET of the framework's one canonical `AGENT_ROLES`, with each
// expert's token budget read from the one canonical `ROLE_TOKEN_BUDGETS`. There is no parallel
// roster and no second budget table (RULE-13: one canonical helper, no divergent copy). The
// model-driven need detector may only ever name a role in this set; the script rejects anything
// else (AC-8), so the model can never invent an expert.

import { AGENT_ROLES, type AgentRole } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';

/**
 * The roles that act as spec-pipeline experts: the domain specialists among `AGENT_ROLES`. Issue
 * #558 seats `product-owner` and `application-architect` at the table, so the non-expert machinery
 * roles are now `implementer, reviewer, verifier, test-planner, gap-detector, requirement-analyst,
 * doc-maintainer, context-curator` — `product-owner` is an expert. Thirteen pickable roles.
 * `chief-architect` is deliberately NOT here: it is never picked by the detector; it runs
 * automatically once any expert fired.
 */
const EXPERT_ROLE_SET: ReadonlySet<AgentRole> = new Set<AgentRole>([
  'db-expert',
  'security-auditor',
  'ux-ui-analyst',
  'performance-analyst',
  'data-modeler',
  'integration-architect',
  'solution-architect',
  'devops-engineer',
  'market-researcher',
  'qa-engineer',
  'user-flow-writer',
  // Issue #558 — two roles seated at the table. `product-owner` also keeps its build-time
  // scope-guard job; `application-architect` is new and owns "where does this land in the app".
  'product-owner',
  'application-architect',
]);

/**
 * The expert roster as an ordered list, derived from `AGENT_ROLES` so its order stays in lockstep
 * with the canonical roster and a role can never appear here without existing there.
 */
export const EXPERT_ROLES: readonly AgentRole[] = AGENT_ROLES.filter((role) =>
  EXPERT_ROLE_SET.has(role),
);

/** Whether an arbitrary string is a valid expert role (AC-8 — the roster gate). */
export function isExpertRole(value: string): value is AgentRole {
  return EXPERT_ROLE_SET.has(value as AgentRole);
}

/**
 * The experts that sit at the table on EVERY spec run once the roster is on, whatever the detector
 * picked (issue #558, FR-1.3). Every change has a customer and a scope (product-owner), lands
 * somewhere in the app's structure (application-architect), changes or leaves alone a user's path
 * (user-flow-writer), and has observable behaviour (qa-engineer). A team may override the set
 * through `spec_pipeline_standing_experts`; the others stay on call.
 */
export const DEFAULT_STANDING_EXPERTS: readonly AgentRole[] = [
  'product-owner',
  'application-architect',
  'user-flow-writer',
  'qa-engineer',
];

/** Which tier an expert sits in on a given run (issue #558). */
export type ExpertTier = 'standing' | 'on-call';

/**
 * The tier of a role for a run, given that run's resolved standing list. A role in the standing
 * list is `standing`; every other expert is `on-call`. Pure and deterministic (INV-4).
 */
export function expertTier(role: AgentRole, standing: readonly AgentRole[]): ExpertTier {
  return standing.includes(role) ? 'standing' : 'on-call';
}

/**
 * The token budget for an expert, from the canonical `ROLE_TOKEN_BUDGETS`. Throws on a role
 * outside the roster rather than guessing a default — an unknown expert is a caller bug, and a
 * silent fallback budget would mask it (RULE-13: surface a failed lookup, never a guessed value).
 */
export function expertBudget(role: AgentRole): number {
  if (!isExpertRole(role)) {
    throw new Error(`not an expert role: ${role}`);
  }
  return ROLE_TOKEN_BUDGETS[role];
}
