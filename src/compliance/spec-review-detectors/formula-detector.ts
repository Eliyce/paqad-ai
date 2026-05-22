import type { SpecReviewDetector } from './types.js';
import { makeLocation, normalizeText } from './shared.js';

// Matches a simple division expression: word / word  or  word / (expr)
const DIVISION_PATTERN = /\b([a-z_]\w*)\s*\/\s*(?:\(([^)]+)\)|([a-z_]\w*))/;

// Phrases that indicate a collection or count may reach zero
const ZERO_CASE_PATTERN =
  /all\s+\w+(?:\s+\w+)*\s+(?:may|can|could)\s+be\s+(?:indeterminate|zero|empty|null|absent)|all\s+\w+(?:\s+\w+)*\s+are\s+(?:indeterminate|zero|empty|absent)|(?:may|can|could)\s+have\s+(?:zero|no)\s+\w+|\bno\s+\w+\s+(?:exist|remain|are\s+present)/;

export const formulaDetector: SpecReviewDetector = {
  name: 'formula_inconsistency',
  detect(context) {
    const defects = [];

    // ── Specific check: covered / (total - indeterminate) with all-indeterminate edge case ──
    const canonicalFormulaLine = context.review_lines.find((line) =>
      /\/\s*\(\s*total\s*-\s*indeterminate\s*\)/.test(normalizeText(line.text)),
    );
    const canonicalZeroCaseLine = context.review_lines.find((line) =>
      /all obligations .* indeterminate|all .* may be indeterminate/.test(normalizeText(line.text)),
    );

    if (canonicalFormulaLine && canonicalZeroCaseLine) {
      defects.push({
        category: 'formula_inconsistency' as const,
        severity: 'critical' as const,
        description:
          'The formula can divide by zero when the spec allows every obligation to be indeterminate.',
        locations: [makeLocation(canonicalFormulaLine), makeLocation(canonicalZeroCaseLine)].sort(
          (a, b) => a.line_range[0] - b.line_range[0],
        ),
        suggested_resolution:
          'Define the zero-denominator behavior or revise the formula so that this input remains valid.',
      });
    }

    // ── Generic check: any division whose denominator shares a keyword with a zero-case statement ──
    for (const line of context.review_lines) {
      const normalized = normalizeText(line.text);
      const divMatch = DIVISION_PATTERN.exec(normalized);
      if (!divMatch) continue;

      const denomExpr = (divMatch[2] ?? divMatch[3])!.trim();
      // Extract the first meaningful word from the denominator expression (skip operators/numbers)
      const denomWord = /\b([a-z_]\w*)\b/.exec(denomExpr)?.[1];
      if (!denomWord || denomWord.length < 3) continue;

      // Skip URLs, file paths, and trivially safe denominators
      if (/http|url|path|file|true|false/.test(denomWord)) continue;

      // Search other lines for a zero-case statement that mentions the same denominator keyword
      const zeroCaseLine = context.review_lines.find((candidate) => {
        if (candidate.line === line.line) return false;
        const candidateText = normalizeText(candidate.text);
        return candidateText.includes(denomWord) && ZERO_CASE_PATTERN.test(candidateText);
      });

      if (zeroCaseLine) {
        defects.push({
          category: 'formula_inconsistency' as const,
          severity: 'critical' as const,
          description: `The formula divides by an expression containing "${denomWord}", but the spec allows a state where that value reaches zero.`,
          locations: [makeLocation(line), makeLocation(zeroCaseLine)].sort(
            (a, b) => a.line_range[0] - b.line_range[0],
          ),
          suggested_resolution: `Guard the formula against a zero "${denomWord}" value, or define behavior for that edge case.`,
        });
      }
    }

    return dedupe(defects);
  },
};

function dedupe<T extends { locations: Array<{ line_range: [number, number] }> }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.locations.map((l) => l.line_range[0]).join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
