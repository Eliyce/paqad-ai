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
  'skill-orchestrator',
  'agent-orchestrator',
]);

export const EXPERT_ROLES: readonly AgentRole[] = AGENT_ROLES.filter((role) =>
  EXPERT_ROLE_SET.has(role),
);

export const EXPERT_OWNS: Readonly<Record<string, string>> = {
  'db-expert': 'Will the migration, index and query shape hold up?',
  'security-auditor': 'Who may do this, and can an attacker abuse it?',
  'ux-ui-analyst': 'Can a user see and operate this screen?',
  'performance-analyst': 'Does this stay fast under real load?',
  'data-modeler': 'Which entities exist and how do they relate?',
  'integration-architect': 'How do we talk to the outside service safely?',
  'solution-architect': 'How do several modules fit together across this change?',
  'devops-engineer': 'How is it built, deployed and configured?',
  'market-researcher': 'Is there a market reason to build it?',
  'qa-engineer': 'What observable behaviour proves it works?',
  'user-flow-writer': 'Which steps does a person take from start to finish?',
  'product-owner': 'Who is it for and what does done mean?',
  'application-architect': 'Which framework piece does each part become?',
  'skill-orchestrator': 'Should this skill exist, and what grounds it?',
  'agent-orchestrator': 'Should this agent exist, and how is it briefed, limited and stopped?',
};

export function expertOwns(role: AgentRole): string {
  const owns = EXPERT_OWNS[role];
  if (owns === undefined) throw new Error(`not an expert role: ${role}`);
  return owns;
}

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
