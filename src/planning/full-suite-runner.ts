import type { SliceFullSuiteCheck } from '@/core/types/planning.js';

export interface FullSuiteRunResult {
  total_tests: number;
  passing: number;
  failing: number;
  failing_tests: string[];
  duration_ms: number;
}

export type FullSuiteRunner = () => Promise<FullSuiteRunResult>;

const SLOW_SUITE_THRESHOLD_MS = 60_000;

export async function verifyFullSuite(
  runFullSuite: FullSuiteRunner,
  baselineFailingTests: string[] = [],
): Promise<SliceFullSuiteCheck> {
  const result = await runFullSuite();
  const baseline = new Set(baselineFailingTests);
  const newFailures = result.failing_tests.filter((test) => !baseline.has(test));
  const preExistingFailures = result.failing_tests.filter((test) => baseline.has(test));

  return {
    total_tests: result.total_tests,
    passing: result.passing,
    failing: result.failing,
    new_failures: newFailures,
    pre_existing_failures: preExistingFailures,
    duration_ms: result.duration_ms,
    slow_suite_warning: result.duration_ms > SLOW_SUITE_THRESHOLD_MS,
  };
}
