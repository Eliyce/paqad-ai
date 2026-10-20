import { FrameworkError } from './framework-error.js';

export interface CancelledErrorDetails extends Record<string, unknown> {
  checkpoint_path?: string;
}

export class CancelledError extends FrameworkError {
  declare readonly code: 'CANCELLED_BY_CONSUMER';

  constructor(message = 'Cancelled by consumer', details?: CancelledErrorDetails) {
    super(message, { code: 'CANCELLED_BY_CONSUMER', details });
    this.name = 'CancelledError';
  }
}

export function isCancelledError(error: unknown): error is CancelledError {
  return error instanceof CancelledError;
}
