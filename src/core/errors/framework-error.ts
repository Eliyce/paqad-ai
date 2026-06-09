import { redactPayload } from './redact.js';
import type { EngineErrorCode } from './taxonomy.js';

export interface FrameworkErrorOptions {
  /**
   * Stable error code. New code should use an {@link EngineErrorCode} from the
   * taxonomy; the `(string & {})` arm keeps backward compatibility with
   * pre-taxonomy subclasses and arbitrary-string construction while preserving
   * literal autocomplete for the known codes.
   */
  code: EngineErrorCode | (string & {});
  cause?: unknown;
  details?: Record<string, unknown>;
  /** Whether the consumer may safely retry. Defaults to `false`. */
  retryable?: boolean;
  /**
   * When provided, string-valued `details` fields are run through the project's
   * secret redaction before the error is surfaced, and the stripped field names
   * are recorded in `details.redacted_fields`. Omitted ⇒ no fs access, details
   * pass through unchanged (the common path for existing subclasses).
   */
  projectRoot?: string;
}

export class FrameworkError extends Error {
  readonly code: EngineErrorCode | (string & {});
  readonly details?: Record<string, unknown>;
  /** Whether the consumer may safely retry the operation that failed. */
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
