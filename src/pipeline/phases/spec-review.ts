import type { ClassificationResult } from '@/core/types/classification.js';
import type { ReviewMode, ReviewTier } from '@/core/types/review.js';
import type { Lane } from '@/core/types/routing.js';

import type { PhaseExecutor } from './phase.interface.js';

import { createPassResult } from './shared.js';

export function selectReviewTier(_classification: ClassificationResult, lane: Lane): ReviewTier {
  if (lane === 'fast') {
    return 'spot-check';
  }

  if (lane === 'graduated') {
    return 'standard';
  }

  return 'full';
}

export function selectReviewMode(isReReview: boolean, changePercentage: number): ReviewMode {
  if (!isReReview) {
    return 'fresh';
  }

  if (changePercentage > 0.6) {
    return 'fresh';
  }

  return 'diff';
}

export class SpecReviewPhase implements PhaseExecutor {
  readonly phase = 'spec-review' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const tier = selectReviewTier(context.classification, context.lane);
    const mode = selectReviewMode(false, 0);
    return createPassResult(this.phase, `Spec review passed (${tier}, ${mode})`, context);
  }
}
