import type { Gate } from './gate.interface.js';

import { checkBooleanGate } from './shared.js';

export class SpecReviewGate implements Gate {
  readonly gate = 'spec-review' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    return checkBooleanGate(
      this.gate,
      context.spec_review_passed,
      'Spec review passed',
      'Spec review failed',
      'Resolve outstanding specification review findings.',
    );
  }
}
