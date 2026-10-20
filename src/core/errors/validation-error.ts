import { FrameworkError } from './framework-error.js';

export class ValidationError extends FrameworkError {
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
