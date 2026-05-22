import type { PhaseExecutor } from './phase.interface.js';
import { summarizeFeatureDevelopmentStage } from '@/pipeline/feature-development-policy.js';

import { createPassResult } from './shared.js';

export class SpecWritingPhase implements PhaseExecutor {
  readonly phase = 'specification' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const stageSummary = summarizeFeatureDevelopmentStage(context.feature_policy, 'specification');
    return createPassResult(
      this.phase,
      stageSummary === null ? 'Specification written' : `Specification written (${stageSummary})`,
      context,
    );
  }
}
