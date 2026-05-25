export const COMPLIANCE_SCHEMA_VERSION = 1 as const;
export const SPEC_REVIEW_SCHEMA_VERSION = 1 as const;

export const DEFAULT_OBLIGATION_INDEX_PATH = '.paqad/compliance/obligation-index.json';

/**
 * Converts a spec file path to a filesystem-safe slug used as the compliance
 * subdirectory name (e.g. `docs/my-spec.md` → `my-spec`).
 */
export function slugifySpec(specFile: string): string {
  const segments = specFile.replace(/\.[^.]+$/, '').split(/[\\/]/);
  const base = segments[segments.length - 1]!;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Returns the per-spec obligation index path (FR-2.1). */
export function specIndexPath(specFile: string): string {
  return `.paqad/compliance/${slugifySpec(specFile)}/obligations.json`;
}

/** Returns the per-spec compliance report path (FR-3.5). */
export function specReportPath(specFile: string): string {
  return `.paqad/compliance/${slugifySpec(specFile)}/report.json`;
}

/** Returns the per-spec spec-quality review path (FR-SQ2.1). */
export function specReviewPath(specFile: string): string {
  return `.paqad/compliance/${slugifySpec(specFile)}/spec-review.json`;
}
