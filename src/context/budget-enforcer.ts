import {
  DEFAULT_CONTEXT_BUDGET,
  resolveContextBudgetForModelTier,
} from '@/core/constants/budgets.js';
import type {
  BudgetBand,
  BudgetBreakdown,
  BudgetBreakdownSuccess,
  ComputeBudgetInput,
  ContextBudgetConfig,
  WorkspaceCompressionPolicy,
} from '@/core/types/context.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { SkillModelTier } from '@/core/types/skill.js';
import { selectModelForTier } from '@/skills/model-selector.js';

import { getOrLoad } from './tokenizer-cache.js';

/**
 * Band thresholds (as window-usage percentages) per workspace compression
 * policy: `[comfortable→tightening, tightening→compressed, compressed→force-summary]`.
 * Values are fixed by PQD-167 AC3.
 */
const COMPRESSION_BAND_THRESHOLDS: Record<
  WorkspaceCompressionPolicy,
  readonly [number, number, number]
> = {
  standard: [60, 80, 95],
  aggressive: [50, 70, 85],
  conservative: [70, 85, 97],
};

function classifyBand(usagePct: number, policy: WorkspaceCompressionPolicy): BudgetBand {
  const [tightening, compressed, forceSummary] = COMPRESSION_BAND_THRESHOLDS[policy];
  const pct = usagePct * 100;
  if (pct < tightening) {
    return 'comfortable';
  }
  if (pct < compressed) {
    return 'tightening';
  }
  if (pct < forceSummary) {
    return 'compressed';
  }
  return 'force-summary';
}

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

  /**
   * Compute an exact token-by-token breakdown of how the active model's context
   * window is consumed by a fully-assembled set of per-turn slices (PQD-167).
   *
   * Returns an error union (rather than substituting a default window) when the
   * model catalog entry has no `context_window_tokens`. Any single retrieved
   * chunk whose token cost exceeds the remaining available budget is excluded
   * from the total and reflected in `dropped_chunk_count` plus a
   * `context.compression_applied` audit record.
   *
   * @since 1.10.0
   */
  static async computeBudget(input: ComputeBudgetInput): Promise<BudgetBreakdown> {
    const { model } = input;
    if (
      typeof model.context_window_tokens !== 'number' ||
      Number.isNaN(model.context_window_tokens)
    ) {
      return {
        ok: false,
        error: 'Model catalog entry is missing context_window_tokens',
        missing_field: 'context_window_tokens',
      };
    }

    const window = model.context_window_tokens;
    const reserved =
      typeof model.max_output_tokens === 'number'
        ? Math.min(input.reserved_output_tokens, model.max_output_tokens)
        : input.reserved_output_tokens;

    const tokenizer = await getOrLoad(model.tokenizer_version);
    const count = (text: string): number => tokenizer.countTokens(text);

    const systemTokens = count(input.system_prompt);
    const projectKnowledgeTokens = count(input.project_knowledge);
    const rollingSummaryTokens = input.rolling_summary === null ? 0 : count(input.rolling_summary);
    const recentTurnsTokens = count(input.recent_turns);
    const newUserMessageTokens = count(input.new_user_message);

    const nonChunkContent =
      systemTokens +
      projectKnowledgeTokens +
      rollingSummaryTokens +
      recentTurnsTokens +
      newUserMessageTokens;

    // Greedy chunk inclusion against the remaining budget guarantees the total
    // never exceeds the window: included chunks sum to at most `available`.
    let remaining = window - nonChunkContent - reserved;
    let retrievedChunksTokens = 0;
    let droppedChunkCount = 0;
    for (const chunk of input.retrieved_chunks) {
      const chunkTokens = count(chunk);
      if (chunkTokens > remaining) {
        droppedChunkCount += 1;
        continue;
      }
      retrievedChunksTokens += chunkTokens;
      remaining -= chunkTokens;
    }

    const totalUsed = nonChunkContent + retrievedChunksTokens + reserved;
    const usagePct = window === 0 ? 0 : totalUsed / window;

    const result: BudgetBreakdownSuccess = {
      ok: true,
      system_prompt_tokens: systemTokens,
      project_knowledge_tokens: projectKnowledgeTokens,
      retrieved_chunks_tokens: retrievedChunksTokens,
      rolling_summary_tokens: input.rolling_summary === null ? '—' : rollingSummaryTokens,
      recent_turns_tokens: recentTurnsTokens,
      new_user_message_tokens: newUserMessageTokens,
      reserved_output_tokens: reserved,
      total_used: totalUsed,
      usage_pct: usagePct,
      band: classifyBand(usagePct, input.compression_policy),
      tokenizer_version: tokenizer.tokenizer_version,
      dropped_chunk_count: droppedChunkCount,
    };

    if (droppedChunkCount > 0) {
      result.compression_audit = {
        event: 'context.compression_applied',
        reason: 'chunk_exceeds_budget',
        dropped_chunk_count: droppedChunkCount,
      };
    }

    return result;
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
