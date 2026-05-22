export interface FrameworkErrorOptions {
  code: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class FrameworkError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: FrameworkErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'FrameworkError';
    this.code = options.code;
    this.details = options.details;
  }
}
