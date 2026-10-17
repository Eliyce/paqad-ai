// PQD-95 — raised when the `.paqad/` schema baseline cannot be satisfied:
// either the project was stamped by a newer engine than the one running
// (future-schema refusal) or the migration lock could not be acquired.

import { FrameworkError } from './framework-error.js';

/**
 * The verbatim line paqad prints when a project's .paqad/ layout was written by a newer paqad than
 * the running engine (issue #616, Parts 8b/9). Shown by doctor, hooks that catch SchemaVersionError,
 * and the dashboard's 409 responses, so the fix is always the same and always discoverable.
 */
export const SCHEMA_VERSION_UPDATE_HINT =
  'This project was set up by a newer paqad. Update paqad to open it: inside Claude Code run ' +
  '`claude plugin update paqad@eliyce`, otherwise `npm i -g paqad-ai@latest`.';

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
