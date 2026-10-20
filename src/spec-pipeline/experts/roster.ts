import { AGENT_ROLES, type AgentRole } from '@/core/types/agent.js';
import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';

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
  'product-owner',
  'application-architect',
]);

export const EXPERT_ROLES: readonly AgentRole[] = AGENT_ROLES.filter((role) =>
  EXPERT_ROLE_SET.has(role),
);

export function isExpertRole(value: string): value is AgentRole {
  return EXPERT_ROLE_SET.has(value as AgentRole);
}

export const DEFAULT_STANDING_EXPERTS: readonly AgentRole[] = [
  'product-owner',
  'application-architect',
  'user-flow-writer',
  'qa-engineer',
];

export type ExpertTier = 'standing' | 'on-call';

export function expertTier(role: AgentRole, standing: readonly AgentRole[]): ExpertTier {
  return standing.includes(role) ? 'standing' : 'on-call';
}

export function expertBudget(role: AgentRole): number {
  if (!isExpertRole(role)) {
    throw new Error(`not an expert role: ${role}`);
  }
  return ROLE_TOKEN_BUDGETS[role];
}
