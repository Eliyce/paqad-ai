import type { BoundaryReport } from './boundary/types.js';
import { BOUNDARY_SCHEMA_VERSION } from './boundary/types.js';
import type { ObligationIndex, SpecReviewReport } from './types.js';
import { COMPLIANCE_SCHEMA_VERSION, SPEC_REVIEW_SCHEMA_VERSION } from './constants.js';

export interface DoctorIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  issues: DoctorIssue[];
}

export function doctorObligationIndex(index: ObligationIndex | null): DoctorResult {
  const issues: DoctorIssue[] = [];

  if (!index) {
    issues.push({ level: 'warning', message: 'No obligation index found.' });
    return { ok: true, issues };
  }

  if (index.metadata.schema_version !== COMPLIANCE_SCHEMA_VERSION) {
    issues.push({
      level: 'error',
      message: `Unsupported compliance schema_version ${index.metadata.schema_version}. Expected ${COMPLIANCE_SCHEMA_VERSION}.`,
    });
  }

  const seen = new Set<string>();
  for (const obligation of index.obligations) {
    if (seen.has(obligation.obligation_id)) {
      issues.push({
        level: 'error',
        message: `Duplicate obligation_id "${obligation.obligation_id}".`,
      });
    }
    seen.add(obligation.obligation_id);
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), issues };
}

export function doctorBoundaryReport(report: BoundaryReport | null): DoctorResult {
  const issues: DoctorIssue[] = [];

  if (!report) {
    issues.push({
      level: 'warning',
      message: 'No boundary report found. Run `compliance boundary` to generate one.',
    });
    return { ok: true, issues };
  }

  if (report.metadata.schema_version !== BOUNDARY_SCHEMA_VERSION) {
    issues.push({
      level: 'error',
      message: `Unsupported boundary schema_version ${report.metadata.schema_version}. Expected ${BOUNDARY_SCHEMA_VERSION}.`,
    });
  }

  if (report.unhandled_count > 0) {
    issues.push({
      level: 'warning',
      message: `${report.unhandled_count} unhandled boundary variant${report.unhandled_count === 1 ? '' : 's'} detected. Run \`compliance boundary --generate\` to create test stubs.`,
    });
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), issues };
}

export function doctorSpecReview(
  review: SpecReviewReport | null,
  options?: { spec_is_newer?: boolean },
): DoctorResult {
  const issues: DoctorIssue[] = [];

  if (!review) {
    issues.push({ level: 'warning', message: 'No spec review report found.' });
    return { ok: true, issues };
  }

  if (review.metadata.schema_version !== SPEC_REVIEW_SCHEMA_VERSION) {
    issues.push({
      level: 'error',
      message: `Unsupported spec review schema_version ${review.metadata.schema_version}. Expected ${SPEC_REVIEW_SCHEMA_VERSION}.`,
    });
  }

  if (options?.spec_is_newer) {
    issues.push({
      level: 'warning',
      message: 'Spec review is stale because the spec was modified after the last review.',
    });
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), issues };
}
