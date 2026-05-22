import {
  DEFAULT_CONTEXT_BUDGET,
  resolveContextBudgetForModelTier,
} from '@/core/constants/budgets.js';
import type { ContextBudgetConfig } from '@/core/types/context.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { SkillModelTier } from '@/core/types/skill.js';
import { selectModelForTier } from '@/skills/model-selector.js';

export type BudgetVerdict = 'ok' | 'warning' | 'requires-justification' | 'blocked';
export type BudgetDecision = 'allow' | 'warn' | 'require-justification' | 'block';

export interface BudgetCheckResult {
  verdict: BudgetVerdict;
  usage_pct: number;
  budget: number;
  actual: number;
  message: string;
}

export interface BudgetEvaluation {
  decision: BudgetDecision;
  usage_ratio: number;
}

export class ContextBudgetEnforcer {
  private readonly budget: ContextBudgetConfig;

  constructor(config?: Partial<ContextBudgetConfig>) {
    this.budget = { ...DEFAULT_CONTEXT_BUDGET, ...config };
  }

  static fromProfile(
    profile: Pick<ProjectProfile, 'model_routing'>,
    tier: SkillModelTier = 'medium',
    overrides?: Partial<ContextBudgetConfig>,
  ): ContextBudgetEnforcer {
    const models = {
      fast: profile.model_routing.fast_model,
      reasoning: profile.model_routing.reasoning_model,
      medium: selectModelForTier(profile, 'medium'),
    } as const;

    return new ContextBudgetEnforcer({
      ...resolveContextBudgetForModelTier(models, tier),
      ...overrides,
    });
  }

  checkBudget(estimatedTokens: number): BudgetCheckResult {
    const budget = this.budget.main_agent_max;
    const pct = budget === 0 ? 0 : estimatedTokens / budget;

    if (pct <= 0.8) {
      return {
        verdict: 'ok',
        usage_pct: pct,
        budget,
        actual: estimatedTokens,
        message: 'Within budget',
      };
    }

    if (pct <= 1) {
      return {
        verdict: 'warning',
        usage_pct: pct,
        budget,
        actual: estimatedTokens,
        message: `Context at ${Math.round(pct * 100)}% of budget — consider reducing loaded files`,
      };
    }

    if (pct <= 1.2) {
      return {
        verdict: 'requires-justification',
        usage_pct: pct,
        budget,
        actual: estimatedTokens,
        message: `Context at ${Math.round(pct * 100)}% of budget — must justify or reduce`,
      };
    }

    return {
      verdict: 'blocked',
      usage_pct: pct,
      budget,
      actual: estimatedTokens,
      message: `Context at ${Math.round(pct * 100)}% of budget — blocked. Select fewer files.`,
    };
  }

  shouldCompact(currentTokens: number): boolean {
    return (
      this.budget.main_agent_max > 0 &&
      currentTokens / this.budget.main_agent_max >= this.budget.compaction_trigger_pct
    );
  }

  evaluate(tokensUsed: number): BudgetEvaluation {
    const result = this.checkBudget(tokensUsed);

    return {
      decision: toLegacyDecision(result.verdict),
      usage_ratio: result.usage_pct,
    };
  }
}

function toLegacyDecision(verdict: BudgetVerdict): BudgetDecision {
  switch (verdict) {
    case 'ok':
      return 'allow';
    case 'warning':
      return 'warn';
    case 'requires-justification':
      return 'require-justification';
    case 'blocked':
      return 'block';
  }
}
