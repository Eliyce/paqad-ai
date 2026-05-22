import { FrameworkError } from './framework-error.js';

export class ValidationError extends FrameworkError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: 'VALIDATION_ERROR',
      details,
    });
    this.name = 'ValidationError';
  }
}
