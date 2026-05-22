import type { PhaseExecutor } from './phase.interface.js';

import { createPassResult } from './shared.js';

export class AnalysisPhase implements PhaseExecutor {
  readonly phase = 'analysis' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    return createPassResult(this.phase, 'Analysis roles completed', context);
  }
}
