import { FrameworkError } from './framework-error.js';

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
