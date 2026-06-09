// PQD-95 — raised when the `.paqad/` schema baseline cannot be satisfied:
// either the project was stamped by a newer engine than the one running
// (future-schema refusal) or the migration lock could not be acquired.

import { FrameworkError } from './framework-error.js';

export interface SchemaVersionErrorOptions {
  code?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class SchemaVersionError extends FrameworkError {
  constructor(message: string, options: SchemaVersionErrorOptions = {}) {
    super(message, {
      code: options.code ?? 'SCHEMA_VERSION_INCOMPATIBLE',
      cause: options.cause,
      details: options.details,
    });
    this.name = 'SchemaVersionError';
  }
}
