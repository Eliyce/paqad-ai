import { FrameworkError } from './framework-error.js';

export class ValidationError extends FrameworkError {
  /**
   * Stable, machine-readable identifier for *which* validation rule fired,
   * narrower than the generic `code: 'VALIDATION_ERROR'`. Optional and
   * backward-compatible — existing two-argument construction leaves it
   * undefined. Consumers (e.g. the skill audit trail, PQD-194) key on this to
   * route a failure to a specific UI behaviour without parsing the message.
   */
  readonly subCode?: string;

  constructor(message: string, details?: Record<string, unknown>, subCode?: string) {
    super(message, {
      code: 'VALIDATION_ERROR',
      details,
    });
    this.name = 'ValidationError';
    this.subCode = subCode;
  }
}
