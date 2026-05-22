import type { SpecReviewDetector } from './types.js';
import { makeLocation, normalizeText } from './shared.js';

const ID_PATTERN = /\b(?:FR|EC|AC|NFR|OQ)-[A-Z0-9][A-Z0-9.-]*\b/g;

export const referenceDetector: SpecReviewDetector = {
  name: 'references',
  detect(context) {
    const defects = [];
    // Use all lines (including headings) so that IDs defined only as heading text
    // (e.g. "### EC-5: Edge Case") are recognised as defined and do not produce
    // false-positive dangling-reference findings.
    const definedIds = collectDefinedIds(context.lines);

    for (const line of context.review_lines) {
      const normalized = normalizeText(line.text);

      if (/\bsee\b .*?\bspec\b/.test(normalized) && ![...line.text.matchAll(ID_PATTERN)].length) {
        defects.push({
          category: 'unresolvable_reference' as const,
          severity: 'minor' as const,
          description: 'The spec references an external document that cannot be validated locally.',
          locations: [makeLocation(line)],
          suggested_resolution:
            'Inline the required contract details or replace the external note with a local reference.',
        });
      }

      const references = [...line.text.matchAll(ID_PATTERN)].map((match) => match[0]!);
      for (const reference of references) {
        if (definedIds.has(reference)) continue;
        defects.push({
          category: 'dangling_reference' as const,
          severity: 'major' as const,
          description: `The spec references ${reference}, but that identifier is not defined.`,
          locations: [makeLocation(line)],
          suggested_resolution: `Define ${reference} or update the reference to the correct identifier.`,
        });
      }
    }

    return dedupeByLineAndCategory(defects);
  },
};

function collectDefinedIds(lines: string[]): Set<string> {
  const defined = new Set<string>();

  for (const text of lines) {
    const trimmed = text.trim();
    const leadingMatches = [
      /^(?:#{1,6}\s+)?((?:FR|EC|AC|NFR|OQ)-[A-Z0-9][A-Z0-9.-]*)\b/,
      /^\*\*((?:FR|EC|AC|NFR|OQ)-[A-Z0-9][A-Z0-9.-]*)\*\*/,
      /^\|\s*((?:FR|EC|AC|NFR|OQ)-[A-Z0-9][A-Z0-9.-]*)\s*\|/,
    ];

    for (const pattern of leadingMatches) {
      const match = pattern.exec(trimmed);
      if (match) {
        defined.add(match[1]!);
      }
    }
  }

  return defined;
}

export function dedupeByLineAndCategory<
  T extends {
    category: string;
    description?: string;
    locations: Array<{ line_range: [number, number] }>;
  },
>(defects: T[]): T[] {
  const seen = new Set<string>();
  return defects.filter((defect) => {
    const key = `${defect.category}:${defect.locations[0]?.line_range[0] ?? 0}:${defect.description ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
