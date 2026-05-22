import type { PhaseExecutor } from './phase.interface.js';
import { summarizeFeatureDevelopmentStage } from '@/pipeline/feature-development-policy.js';

import { createPassResult } from './shared.js';

export class StoryPlanningPhase implements PhaseExecutor {
  readonly phase = 'sequence-planning' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const stageSummary = summarizeFeatureDevelopmentStage(context.feature_policy, 'planning');
    return createPassResult(
      this.phase,
      stageSummary === null ? 'Story sequence planned' : `Story sequence planned (${stageSummary})`,
      context,
    );
  }
}
