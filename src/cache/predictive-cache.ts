import { createHash } from 'node:crypto';
import type { TransitionLogManager } from './transition-log.js';
import type { CacheWarmer } from './cache-warmer.js';
import type { CacheMetricsTracker } from './metrics.js';

export interface PredictiveCacheOptions {
  enabled: boolean;
  confidence_threshold: number; // default 0.7
  max_candidates: number; // default 3
}

export const DEFAULT_PREDICTIVE_CACHE_OPTIONS: PredictiveCacheOptions = {
  enabled: true,
  confidence_threshold: 0.7,
  max_candidates: 3,
};

export class PredictiveCache {
  constructor(
    private readonly transitionLog: TransitionLogManager,
    private readonly warmer: CacheWarmer,
    private readonly metrics: CacheMetricsTracker,
    private readonly options: PredictiveCacheOptions = DEFAULT_PREDICTIVE_CACHE_OPTIONS,
  ) {}

  async onSkillComplete(
    sessionId: string,
    stackKey: string,
    workflow: string,
    completedSkill: string,
    outputHash: string,
    nextSkill?: string,
  ): Promise<void> {
    // Record the transition
    if (nextSkill) {
      await this.transitionLog.append({
        timestamp: new Date().toISOString(),
        workflow,
        stack_key: stackKey,
        from_skill: completedSkill,
        to_skill: nextSkill,
        from_outputs_hash: outputHash,
      });
    }

    if (!this.options.enabled) return;

    // Get predicted next skills
    const candidates = await this.transitionLog.computeProbabilities(stackKey, completedSkill);

    const aboveThreshold = candidates
      .filter((c) => c.probability >= this.options.confidence_threshold)
      .slice(0, this.options.max_candidates);

    for (const candidate of aboveThreshold) {
      try {
        const warmed = await this.warmer.prewarm(candidate.to_skill, [outputHash]);
        if (warmed) {
          await this.metrics.record(sessionId, 'prewarm_hit');
        } else {
          await this.metrics.record(sessionId, 'prewarm_skipped');
        }
      } catch {
        await this.metrics.record(sessionId, 'prewarm_miss');
      }
    }
  }

  static computeOutputHash(output: string): string {
    return createHash('sha256').update(output).digest('hex');
  }
}
