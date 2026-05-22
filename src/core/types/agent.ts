export const AGENT_ROLES = [
  'context-curator',
  'solution-architect',
  'db-expert',
  'ux-ui-analyst',
  'product-owner',
  'market-researcher',
  'implementer',
  'reviewer',
  'verifier',
  'security-auditor',
  'test-planner',
  'gap-detector',
  'requirement-analyst',
  'devops-engineer',
  'doc-maintainer',
  'performance-analyst',
  'data-modeler',
  'integration-architect',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface TokenBudget {
  analysis: number;
  implementation: number;
  review: number;
}

export interface SubagentConfig {
  role: AgentRole;
  description: string;
  tools: string[];
  model?: string;
  token_budget: number;
  early_termination_allowed: boolean;
}
