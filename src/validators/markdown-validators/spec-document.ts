import { validateAcStatements, validateRequiredHeadings } from './shared.js';

export function validateSpecDocument(markdown: string) {
  const required = validateRequiredHeadings(markdown, [
    '## User Story',
    '## Acceptance Criteria',
    '## Test Plan',
  ]);
  const ac = validateAcStatements(markdown);

  return {
    valid: required.valid && ac.valid,
    errors: [...required.errors, ...ac.errors],
  };
}
