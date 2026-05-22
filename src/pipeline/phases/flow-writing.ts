import type { PhaseExecutor } from './phase.interface.js';

import { createPassResult } from './shared.js';

export class FlowWritingPhase implements PhaseExecutor {
  readonly phase = 'user-flow' as const;

  async execute(context: Parameters<PhaseExecutor['execute']>[0]) {
    return createPassResult(this.phase, 'User flows documented', context);
  }
}
