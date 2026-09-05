// The expert roster (issue #521, Phase 2 — FR-1 / INV-3).
//
// The roster is the EXPERT SUBSET of the framework's one canonical `AGENT_ROLES`, with each
// expert's token budget read from the one canonical `ROLE_TOKEN_BUDGETS`. There is no parallel
// roster and no second budget table (RULE-13: one canonical helper, no divergent copy). The
// model-driven need detector may only ever name a role in this set; the script rejects anything
// else (AC-8), so the model can never invent an expert.

import { AGENT_ROLES, type AgentRole } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';

/**
 * The roles that act as spec-pipeline experts: the domain specialists among `AGENT_ROLES`, as
 * enumerated in issue #521 §2.3. The non-expert roles (implementer, reviewer, verifier,
 * test-planner, gap-detector, requirement-analyst, product-owner, doc-maintainer,
 * context-curator) are the pipeline's own machinery, never an on-demand expert.
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
