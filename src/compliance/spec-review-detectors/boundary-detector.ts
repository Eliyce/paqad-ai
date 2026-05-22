import type { SpecReviewDetector } from './types.js';
import { makeLocation, normalizeText } from './shared.js';

export const boundaryDetector: SpecReviewDetector = {
  name: 'boundary_gap',
  detect(context) {
    const defects = [];

    for (const line of context.review_lines) {
      const normalized = normalizeText(line.text);
      const limitMatch =
        /\b(?:maximum|max(?:imum)?|minimum|min|threshold|limit)\b.*?(\d[\d,]*)/.exec(normalized);
      if (!limitMatch) continue;
      if (/exactly|equal to|at the boundary|inclusive/.test(normalized)) continue;

      const value = limitMatch[1]!.replace(/,/g, '');
      const relatedLines = context.review_lines.filter((candidate) => {
        const text = normalizeText(candidate.text);
        return (
          text.includes(value) ||
          /\btruncate|truncation|append truncation marker|clamp|reject\b/.test(text)
        );
      });

      const hasBoundaryRule = relatedLines.some((candidate) =>
        /exactly|equal to|at the boundary|inclusive/.test(normalizeText(candidate.text)),
      );
      const hasTransitionBehavior = relatedLines.some((candidate) =>
        /\btruncate|truncation|append truncation marker|clamp|reject\b/.test(
          normalizeText(candidate.text),
        ),
      );

      if (hasTransitionBehavior && !hasBoundaryRule) {
        defects.push({
          category: 'boundary_gap' as const,
          severity: 'major' as const,
          description: `The spec defines a ${value}-value limit but never states the exact boundary behavior.`,
          locations: [makeLocation(line)],
          suggested_resolution: `State what happens at exactly ${value}.`,
        });
      }
    }

    return defects;
  },
};
