import { FrameworkError } from './framework-error.js';

export class ResolutionError extends FrameworkError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: 'RESOLUTION_ERROR',
      details,
    });
    this.name = 'ResolutionError';
  }
}
