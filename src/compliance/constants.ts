import { slugifyAscii } from '@/core/text/trim-char.js';

export const COMPLIANCE_SCHEMA_VERSION = 1 as const;
export const SPEC_REVIEW_SCHEMA_VERSION = 1 as const;

export const DEFAULT_OBLIGATION_INDEX_PATH = '.paqad/compliance/obligation-index.json';

export function slugifySpec(specFile: string): string {
  const segments = specFile.replace(/\.[^.]+$/, '').split(/[\\/]/);
  const base = segments[segments.length - 1]!;
  return slugifyAscii(base);
}

export function specIndexPath(specFile: string): string {
  return `.paqad/compliance/${slugifySpec(specFile)}/obligations.json`;
}

export function specReportPath(specFile: string): string {
  return `.paqad/compliance/${slugifySpec(specFile)}/report.json`;
}

export function specReviewPath(specFile: string): string {
  return `.paqad/compliance/${slugifySpec(specFile)}/spec-review.json`;
}
