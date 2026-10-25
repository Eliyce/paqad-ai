import type { Gate } from './gate.interface.js';

import { checkJudgedGate } from './shared.js';

export class RequirementCompletenessGate implements Gate {
  readonly gate = 'requirement-completeness' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    return checkJudgedGate(
      this.gate,
      context.requirements_complete,
      'Requirements are complete',
      'Requirements are incomplete',
      'Complete the missing requirements before proceeding.',
      'No requirement check was recorded, so this gate did not run.',
    );
  }
}
