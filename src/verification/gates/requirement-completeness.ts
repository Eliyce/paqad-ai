import type { Gate } from './gate.interface.js';

import { checkBooleanGate } from './shared.js';

export class RequirementCompletenessGate implements Gate {
  readonly gate = 'requirement-completeness' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    return checkBooleanGate(
      this.gate,
      context.requirements_complete,
      'Requirements are complete',
      'Requirements are incomplete',
      'Complete the missing requirements before proceeding.',
    );
  }
}
