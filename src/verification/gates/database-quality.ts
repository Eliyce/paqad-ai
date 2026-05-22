import type { Gate } from './gate.interface.js';

import { checkBooleanGate } from './shared.js';

export class DatabaseQualityGate implements Gate {
  readonly gate = 'database-quality' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    return checkBooleanGate(
      this.gate,
      context.database_quality_passed,
      'Database quality checks passed',
      'Database quality checks failed',
      'Address schema, migration, or query quality issues.',
    );
  }
}
