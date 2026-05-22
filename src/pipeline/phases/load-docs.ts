import type { PhaseExecutor } from './phase.interface.js';
import { summarizeFeatureDevelopmentStage } from '@/pipeline/feature-development-policy.js';

import { createPassResult } from './shared.js';

export class LoadDocsPhase implements PhaseExecutor {
  readonly phase = 'docs-first-load' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    const stageSummary = summarizeFeatureDevelopmentStage(context.feature_policy, 'planning');
    return createPassResult(
      this.phase,
      stageSummary === null
        ? 'Docs-first context prepared'
        : `Docs-first context prepared (${stageSummary})`,
      context,
    );
  }
}
