import type { AgentRole } from '../types/agent.js';
import type { ContextBudget, ContextLevel } from '../types/context.js';
import type { SkillModelTier } from '../types/skill.js';

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  config_tokens: 1500,
  skills_per_session: 3000,
  main_agent_max: 30000,
  compaction_trigger_pct: 0.8,
};

const FAST_MODEL_PATTERN = /\b(mini|small|nano|flash|haiku|instant|lite|turbo|8b|3\.5)\b/i;
const REASONING_MODEL_PATTERN = /\b(reasoning|o1|o3|o4|deep|think|pro|max)\b/i;

export function resolveContextBudgetForModel(
  modelName: string,
  baseBudget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): ContextBudget {
  if (FAST_MODEL_PATTERN.test(modelName)) {
    return {
      ...baseBudget,
      main_agent_max: 18000,
      skills_per_session: 2000,
      compaction_trigger_pct: 0.7,
    };
  }

  if (REASONING_MODEL_PATTERN.test(modelName)) {
    return {
      ...baseBudget,
      main_agent_max: 45000,
      skills_per_session: 4000,
      compaction_trigger_pct: 0.85,
    };
  }

  return { ...baseBudget };
}

export function resolveContextBudgetForModelTier(
  models: Record<SkillModelTier, string>,
  tier: SkillModelTier,
  baseBudget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): ContextBudget {
  return resolveContextBudgetForModel(models[tier], baseBudget);
}

export const CONTEXT_LEVEL_BUDGETS: Record<ContextLevel, number> = {
  0: 1500,
  1: 4000,
  2: 8000,
  3: 16000,
  4: 30000,
};

export const ROLE_TOKEN_BUDGETS: Record<AgentRole, number> = {
  'context-curator': 6000,
  'solution-architect': 8000,
  'db-expert': 6000,
  'ux-ui-analyst': 5000,
  'product-owner': 5000,
  'market-researcher': 5000,
  implementer: 12000,
  reviewer: 10000,
  verifier: 4000,
  'security-auditor': 8000,
  'test-planner': 6000,
  'gap-detector': 7000,
  'requirement-analyst': 6000,
  'devops-engineer': 5000,
  'doc-maintainer': 4000,
  'performance-analyst': 6000,
  'data-modeler': 6000,
  'integration-architect': 8000,
};
