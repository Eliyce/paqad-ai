import { redactPayload } from './redact.js';
import type { EngineErrorCode } from './taxonomy.js';

export interface FrameworkErrorOptions {
  code: EngineErrorCode | (string & {});
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
  projectRoot?: string;
}

export class FrameworkError extends Error {
  readonly code: EngineErrorCode | (string & {});
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(message: string, options: FrameworkErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'FrameworkError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;

    if (options.details && options.projectRoot) {
      const { redacted, redacted_fields } = redactPayload(options.details, options.projectRoot);
      this.details = redacted_fields.length > 0 ? { ...redacted, redacted_fields } : redacted;
    } else {
      this.details = options.details;
    }
  }
}
