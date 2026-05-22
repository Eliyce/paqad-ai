import type { SpecReviewDetector } from './types.js';
import { makeLocation, normalizeText } from './shared.js';

const POSITIVE_PATH_PATTERN = /when[\s\S]*(100%|below threshold)/;
const INDETERMINATE_ALL_PATTERN =
  /all obligations[\s\S]*indeterminate[\s\S]*(return|warn|skip|pass|fail|must)/;
const NEGATIVE_PATH_PATTERN = /when not |otherwise|else|if not/;

export const missingNegativeDetector: SpecReviewDetector = {
  name: 'missing_negative_case',
  detect(context) {
    const defects = [];
    const positiveLine = context.review_lines.find((line) => {
      const text = normalizeText(line.text);
      return POSITIVE_PATH_PATTERN.test(text);
    });
    const negativeLine = context.review_lines.find((line) =>
      hasNegativePath(normalizeText(line.text)),
    );

    if (positiveLine && !negativeLine) {
      defects.push({
        category: 'missing_negative_case' as const,
        severity: 'major' as const,
        description:
          'The spec defines conditional success or failure behavior but leaves the negative path undefined.',
        locations: [makeLocation(positiveLine)],
        suggested_resolution:
          'Define what happens when the stated condition does not hold, especially for indeterminate or empty inputs.',
      });
    }

    return defects;
  },
};

export function hasNegativePath(text: string): boolean {
  return INDETERMINATE_ALL_PATTERN.test(text) || NEGATIVE_PATH_PATTERN.test(text);
}
