import type { Gate } from './gate.interface.js';

import { checkBooleanGate, createNotRequired } from './shared.js';

export class SpecReviewGate implements Gate {
  readonly gate = 'spec-review' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    if (context.lane === 'fast') {
      return createNotRequired(this.gate, 'This lane has no specification stage to review.');
    }
    if (context.spec_review_passed && context.spec_review_inconclusive) {
      return {
        gate: this.gate,
        passed: true,
        inconclusive: true,
        detail: context.spec_review_detail ?? 'Nothing on record proves the spec was reviewed.',
      };
    }
    return checkBooleanGate(
      this.gate,
      context.spec_review_passed,
      'Spec review passed',
      'Spec review failed',
      'Resolve outstanding specification review findings.',
    );
  }
}
