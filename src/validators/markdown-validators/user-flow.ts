import { validateRequiredHeadings } from './shared.js';

export function validateUserFlow(markdown: string) {
  return validateRequiredHeadings(markdown, ['## Actors', '## Preconditions', '## Main Flow']);
}
