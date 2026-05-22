import type { SpecReviewDetector } from './types.js';
import { makeLocation, normalizeText } from './shared.js';

interface ConflictRule {
  /** Description template (call with the matched pair). */
  description: string;
  /** Matches lines that assert a preservation / completeness goal. */
  preservePattern: RegExp;
  /** Matches lines that assert a discard / exclusion rule. */
  discardPattern: RegExp;
  suggested_resolution: string;
}

const CONFLICT_RULES: ConflictRule[] = [
  {
    description:
      'A lossless extraction goal conflicts with a rule that ignores partially matching tables.',
    preservePattern: /\blossless\b|must preserve all data/,
    discardPattern: /\bignore\b.*\btable\b|non-matching tables .* ignored/,
    suggested_resolution: 'Define which rule wins when a structure is partially recognized.',
  },
  {
    description:
      'A "must preserve all" completeness requirement conflicts with a rule that excludes or skips items.',
    preservePattern:
      /\bmust preserve all\b|\bno data (?:may be )?lost\b|\bcompleteness (?:is )?required\b|\bnothing (?:should|must) be (?:lost|dropped|discarded)\b/,
    discardPattern:
      /(?:\b(?:exclud\w*|skip\w*|filter(?:\s+out)?|discard\w*|omit\w*)\b.*\b(?:items?|entries?|records?|rows?|fields?)\b|\b(?:items?|entries?|records?|rows?|fields?)\b.*\b(?:exclud\w*|skip\w*|filter(?:\s+out)?|discard\w*|omit\w*)\b)/,
    suggested_resolution:
      'Specify what takes priority: completeness or the exclusion rule, and define behavior for items caught by both.',
  },
  {
    description:
      'An all-or-nothing "must succeed for all items" requirement conflicts with language that allows partial or incomplete processing.',
    preservePattern:
      /\bmust (?:succeed|complete|process)\s+(?:for\s+)?all\b|\ball\s+\w+\s+must\s+be\s+(?:processed|handled|covered)\b/,
    discardPattern:
      /\bpartial(?:ly)?\b|\bmay\s+(?:fail|be\s+skipped|be\s+incomplete)\b|\bnot\s+all\s+\w+\s+(?:will|may|might)\b/,
    suggested_resolution:
      'Reconcile the all-or-nothing requirement with the partial-processing allowance.',
  },
];

export const goalConflictDetector: SpecReviewDetector = {
  name: 'goal_conflict',
  detect(context) {
    const defects = [];

    for (const rule of CONFLICT_RULES) {
      const preserveLine = context.review_lines.find((line) =>
        rule.preservePattern.test(normalizeText(line.text)),
      );
      const discardLine = context.review_lines.find((line) =>
        rule.discardPattern.test(normalizeText(line.text)),
      );

      if (preserveLine && discardLine) {
        defects.push({
          category: 'goal_conflict' as const,
          severity: 'major' as const,
          description: rule.description,
          locations: [makeLocation(preserveLine), makeLocation(discardLine)].sort(
            (a, b) => a.line_range[0] - b.line_range[0],
          ),
          suggested_resolution: rule.suggested_resolution,
        });
      }
    }

    return defects;
  },
};
