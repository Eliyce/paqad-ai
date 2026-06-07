import type { ExecutionSlice, PlanningManifest } from '@/core/types/planning.js';

const CRITERION_ID_PATTERN = /^AC-\d+$/;

export type SliceGranularityCode = 'below-floor' | 'combined-without-reason';

/**
 * One way a slice breaks the "default unit = one acceptance criterion" rule
 * (issue #104). `below-floor` means the slice proves no independently-testable
 * criterion; `combined-without-reason` means it bundles several without
 * recording why separating them would break the work.
 */
export interface SliceGranularityFinding {
  slice_id: string;
  code: SliceGranularityCode;
  covered_criteria: string[];
  detail: string;
}

export interface SliceGranularityReport {
  ok: boolean;
  findings: SliceGranularityFinding[];
}

/**
 * Enforces the slice-granularity floor for `graduated` / `full` lanes: the
 * default unit of work is exactly one acceptance criterion, planning never
 * slices below one (a criterion is proven as a whole, with its parts —
 * `negative_cases` / `edge_cases` — built together), and a slice may cover more
 * than one criterion only when it records a `combine_reason`.
 *
 * The `fast` lane is intentionally exempt: trivial work builds in one step with
 * no slicing ceremony (issue #104). Fast-lane manifests return `ok` with no
 * findings.
 */
export function checkSliceGranularity(manifest: PlanningManifest): SliceGranularityReport {
  if (manifest.classification.lane === 'fast') {
    return { ok: true, findings: [] };
  }

  const criterionIds = new Set(
    manifest.verification_matrix.map((criterion) => criterion.criterion_id),
  );

  const findings: SliceGranularityFinding[] = [];
  for (const slice of manifest.execution_slices) {
    const coveredCriteria = coveredCriteriaFor(slice, criterionIds);

    if (coveredCriteria.length === 0) {
      findings.push({
        slice_id: slice.slice_id,
        code: 'below-floor',
        covered_criteria: coveredCriteria,
        detail: `${slice.slice_id} covers no acceptance criterion; every slice must prove at least one independently-testable criterion.`,
      });
      continue;
    }

    if (coveredCriteria.length > 1 && !hasCombineReason(slice)) {
      findings.push({
        slice_id: slice.slice_id,
        code: 'combined-without-reason',
        covered_criteria: coveredCriteria,
        detail: `${slice.slice_id} combines ${coveredCriteria.length} criteria (${coveredCriteria.join(', ')}) without a recorded combine_reason.`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

function coveredCriteriaFor(slice: ExecutionSlice, criterionIds: Set<string>): string[] {
  return slice.covers.filter(
    (cover) => CRITERION_ID_PATTERN.test(cover) && criterionIds.has(cover),
  );
}

function hasCombineReason(slice: ExecutionSlice): boolean {
  return typeof slice.combine_reason === 'string' && slice.combine_reason.trim().length > 0;
}
