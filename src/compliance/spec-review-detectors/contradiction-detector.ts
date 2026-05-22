import type { SpecReviewDetector } from './types.js';
import { makeLocation, normalizeText } from './shared.js';

export const contradictionDetector: SpecReviewDetector = {
  name: 'contradiction',
  detect(context) {
    const defects = [];
    const exclusionLine = context.review_lines.find((line) =>
      /exclude(?:d)? .*denominator|excluded from the denominator/.test(normalizeText(line.text)),
    );
    const formulaLine = context.review_lines.find((line) =>
      /(?:compliance_)?ratio\s*=.*\/\s*total\b|covered\s*\/\s*total\b/.test(
        normalizeText(line.text),
      ),
    );

    if (exclusionLine && formulaLine) {
      defects.push({
        category: 'contradiction' as const,
        severity: 'critical' as const,
        description:
          'The denominator rule excludes obligations, but the stated formula still divides by total.',
        locations: [makeLocation(exclusionLine), makeLocation(formulaLine)].sort(
          (a, b) => a.line_range[0] - b.line_range[0],
        ),
        suggested_resolution: 'Clarify one denominator rule and align the formula with that rule.',
      });
    }

    const alwaysLines = context.review_lines.filter((line) =>
      /\balways\b/.test(normalizeText(line.text)),
    );
    const neverLines = context.review_lines.filter((line) =>
      /\bnever\b/.test(normalizeText(line.text)),
    );

    for (const left of alwaysLines) {
      const leftText = normalizeText(left.text);
      const quotedSubject = extractQuotedSubject(left.text);
      for (const right of neverLines) {
        const rightText = normalizeText(right.text);
        const subject =
          quotedSubject ??
          extractQuotedSubject(right.text) ??
          inferSharedSubject(leftText, rightText);
        if (!subject) continue;
        if (left.line === right.line) continue;
        if (!leftText.includes(subject) || !rightText.includes(subject)) continue;
        defects.push({
          category: 'contradiction' as const,
          severity: 'major' as const,
          description: `The spec gives both "always" and "never" guidance for ${subject}.`,
          locations: [makeLocation(left), makeLocation(right)].sort(
            (a, b) => a.line_range[0] - b.line_range[0],
          ),
          suggested_resolution: `Choose one rule for ${subject} or define when each rule applies.`,
        });
        break; // one contradiction per "always" subject is sufficient; continue to the next left
      }
    }

    return defects;
  },
};

function extractQuotedSubject(text: string): string | null {
  const match = /[`'"]([^`'"]+)[`'"]/.exec(text);
  return match ? normalizeText(match[1]!) : null;
}

function inferSharedSubject(left: string, right: string): string | null {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'to',
    'for',
    'of',
    'in',
    'on',
    'with',
    'must',
    'should',
    'always',
    'never',
    'be',
    'is',
    'are',
    'when',
    'if',
    'then',
  ]);

  const leftTokens = tokenize(left).filter((token) => !stopWords.has(token));
  const rightTokens = new Set(tokenize(right).filter((token) => !stopWords.has(token)));
  const overlap = leftTokens.filter((token) => rightTokens.has(token));
  if (overlap.length === 0) return null;
  return overlap.sort((a, b) => b.length - a.length)[0]!;
}

function tokenize(text: string): string[] {
  return text
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}
