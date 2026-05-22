import type { SliceScopeViolation } from '@/core/types/planning.js';

import type { SliceGateDetail } from './slice-gate.js';

export interface SliceRetryFeedback {
  failing_criteria: string[];
  failing_regressions: string[];
  scope_violations: SliceScopeViolation[];
  new_full_suite_failures: string[];
  instruction: string;
}

export function buildSliceRetryFeedback(gate: SliceGateDetail): SliceRetryFeedback {
  return {
    failing_criteria: gate.criteria_checks
      .filter((check) => !check.passed)
      .map((check) => check.criterion_id),
    failing_regressions: gate.regression_checks
      .filter((check) => !check.passed)
      .map((check) => check.entry_id),
    scope_violations: gate.scope_check.violations,
    new_full_suite_failures: gate.full_suite_check.new_failures,
    instruction:
      'The following tests are failing. Fix the implementation to make them pass without introducing new scope violations.',
  };
}

export function requiresImmediateEscalation(gate: SliceGateDetail): boolean {
  return gate.scope_check.violations.some((violation) => violation.type === 'protected-file');
}
