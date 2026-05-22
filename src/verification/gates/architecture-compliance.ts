import type { Gate } from './gate.interface.js';

import { checkBooleanGate } from './shared.js';

export class ArchitectureComplianceGate implements Gate {
  readonly gate = 'architecture-compliance' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    return checkBooleanGate(
      this.gate,
      context.architecture_compliant,
      'Architecture compliance checks passed',
      'Architecture compliance checks failed',
      'Align the implementation with the architectural constraints.',
    );
  }
}
