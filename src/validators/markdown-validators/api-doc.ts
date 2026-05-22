import type { MarkdownValidationResult } from './shared.js';
import { validateRequiredHeadings } from './shared.js';

const ENDPOINT_HEADING = /^###\s+(GET|POST|PUT|PATCH|DELETE)\s+\/\S+/m;
const REQUIRED_FIELDS = [
  '**Method**',
  '**Route**',
  '**Auth**',
  '**Description**',
  '**Request Schema**',
  '**Response Schema**',
] as const;

export function validateApiDoc(markdown: string): MarkdownValidationResult {
  const required = validateRequiredHeadings(markdown, ['## Endpoints']);
  const errors = [...required.errors];

  if (!ENDPOINT_HEADING.test(markdown)) {
    errors.push('Missing endpoint heading in the format: ### {METHOD} {Route}');
  }

  for (const field of REQUIRED_FIELDS) {
    if (!markdown.includes(field)) {
      errors.push(`Missing required API doc field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
