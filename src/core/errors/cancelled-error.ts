import { FrameworkError } from './framework-error.js';

export interface CancelledErrorDetails extends Record<string, unknown> {
  /**
   * When the cancelled call left a resumable partial state on disk, this points
   * at the checkpoint the consumer can resume from (e.g. a `.partial` index).
   */
  checkpoint_path?: string;
}

/**
 * Thrown internally when a long-running engine call is cancelled by the consumer
 * via an `AbortSignal` (PQD-104). Public-facing entry points either convert this
 * into a stable resolved outcome (e.g. `PipelineResult.cancelled`) or re-throw it
 * with `details.checkpoint_path` set so the consumer can resume.
 */
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
