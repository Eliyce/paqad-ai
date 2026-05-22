import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type {
  BudgetTier,
  BudgetOptimizerState,
  ContextSegmentPriority,
  SummarizedTurn,
} from '../core/types/context.js';
import type { ProjectProfile } from '../core/types/project-profile.js';
import { resolveContextBudgetForModelTier } from '../core/constants/budgets.js';
import { selectModelForTier } from '../skills/model-selector.js';
import { TurnSummarizer } from './turn-summarizer.js';
import { PriorityClassifier } from './priority-classifier.js';
import { ContextEvictor } from './context-evictor.js';

export interface BudgetOptimizerConfig {
  strategy: 'aggressive' | 'balanced' | 'conservative';
  summarize_after_turns: number;
}

const TIER_THRESHOLDS = {
  aggressive: { yellow: 0.5, amber: 0.7, red: 0.85 },
  balanced: { yellow: 0.6, amber: 0.8, red: 0.9 },
  conservative: { yellow: 0.7, amber: 0.85, red: 0.95 },
};

export class ContextBudgetOptimizer {
  /** Reserved for priority-aware segment selection in future phases. */
  readonly classifier: PriorityClassifier;

  constructor(
    private readonly summarizer: TurnSummarizer,
    classifier: PriorityClassifier,
    private readonly evictor: ContextEvictor,
    private readonly projectRoot: string,
    private readonly config: BudgetOptimizerConfig = {
      strategy: 'balanced',
      summarize_after_turns: 15,
    },
  ) {
    this.classifier = classifier;
  }

  static fromProfile(
    projectRoot: string,
    profile: Pick<ProjectProfile, 'efficiency' | 'model_routing'>,
    summarizer = new TurnSummarizer(),
    classifier = new PriorityClassifier(),
    evictor = new ContextEvictor(),
  ): ContextBudgetOptimizer {
    return new ContextBudgetOptimizer(summarizer, classifier, evictor, projectRoot, {
      strategy: profile.efficiency.context_budget_strategy ?? 'balanced',
      summarize_after_turns: profile.efficiency.auto_summarize_interval ?? 15,
    });
  }

  async evaluate(
    tokensUsed: number,
    maxTokens: number,
    metrics: Partial<
      Pick<BudgetOptimizerState, 'summarized_turn_count' | 'evicted_segment_count'>
    > & {
      current_hit_rate?: number;
      target_hit_rate?: number;
    } = {},
  ): Promise<{ action: 'continue' | 'warn' | 'compact'; tier: BudgetTier }> {
    const ratio = tokensUsed / maxTokens;
    const baseTier = this.classifyTier(ratio);
    const hitRateBelowTarget =
      metrics.current_hit_rate !== undefined &&
      metrics.target_hit_rate !== undefined &&
      metrics.current_hit_rate < metrics.target_hit_rate;
    const tier = hitRateBelowTarget ? 'red' : baseTier;

    let action: 'continue' | 'warn' | 'compact';
    if (tier === 'red') {
      action = 'compact';
    } else if (tier === 'amber') {
      action = 'warn';
    } else {
      action = 'continue';
    }

    await this.saveState({
      tier,
      tokens_used: tokensUsed,
      max_tokens: maxTokens,
      last_evaluated_at: new Date().toISOString(),
      summarized_turn_count: metrics.summarized_turn_count ?? 0,
      evicted_segment_count: metrics.evicted_segment_count ?? 0,
      recommended_action: action,
      enforcement_reason: hitRateBelowTarget
        ? 'context-hit-rate-below-target'
        : action === 'compact'
          ? 'token-budget-tight'
          : 'healthy',
    });

    return { action, tier };
  }

  async summarizeTurns(
    turns: Array<{ text: string; timestamp: string }>,
    olderThanIndex: number,
  ): Promise<SummarizedTurn[]> {
    return turns
      .slice(0, olderThanIndex)
      .map((t, i) => this.summarizer.summarize(t.text, i, t.timestamp));
  }

  evictSegments(segments: ContextSegmentPriority[], tier: BudgetTier) {
    return this.evictor.evict(segments, tier);
  }

  summarizeBeforeIndex(turnCount: number): number {
    return Math.max(0, turnCount - this.config.summarize_after_turns);
  }

  resolveMaxTokens(profile: Pick<ProjectProfile, 'model_routing'>): number {
    const models = {
      fast: profile.model_routing.fast_model,
      reasoning: profile.model_routing.reasoning_model,
      medium: selectModelForTier(profile, 'medium'),
    } as const;

    return resolveContextBudgetForModelTier(models, 'medium').main_agent_max;
  }

  async saveState(state: BudgetOptimizerState): Promise<void> {
    try {
      const statePath = join(this.projectRoot, '.paqad', 'session', 'context-budget.json');
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch {
      // non-critical
    }
  }

  private classifyTier(ratio: number): BudgetTier {
    const thresholds = TIER_THRESHOLDS[this.config.strategy];
    if (ratio > thresholds.red) return 'red';
    if (ratio > thresholds.amber) return 'amber';
    if (ratio > thresholds.yellow) return 'yellow';
    return 'green';
  }
}
