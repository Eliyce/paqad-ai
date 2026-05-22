import type { MarkdownValidationResult } from './shared.js';
import { validateRequiredHeadings } from './shared.js';

const ERROR_HEADING = /^###\s+[A-Z]{2,5}-[0-9]{3}:\s+.+$/m;
const REQUIRED_FIELDS = [
  '**Code**',
  '**User-Facing Message**',
  '**Trigger**',
  '**Recovery Path**',
] as const;

export function validateErrorCatalogMarkdown(markdown: string): MarkdownValidationResult {
  const required = validateRequiredHeadings(markdown, ['## Error Code Format', '## Errors']);
  const errors = [...required.errors];

  if (!ERROR_HEADING.test(markdown)) {
    errors.push('Missing error heading in the format: ### {CODE}: {Description}');
  }

  for (const field of REQUIRED_FIELDS) {
    if (!markdown.includes(field)) {
      errors.push(`Missing required error catalog field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
