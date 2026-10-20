import type {
  GreenBaseline,
  GreenBaselineSource,
  RegressionVerdict,
} from '@/core/types/fix-protocol.js';
import type { TestIssueSnapshot } from '@/core/types/token-efficiency.js';
import type { EvidenceOverallStatus } from '@/core/types/verification-evidence.js';
import { createTestDelta } from '@/token-efficiency/index.js';

export interface BaselineEvidenceSummary {
  overall_status: EvidenceOverallStatus;
  issues: TestIssueSnapshot[];
}

export interface ResolveGreenBaselineInput {
  last_evidence: BaselineEvidenceSummary | null;
  tree_changed_since_evidence: boolean;
  rerun: () => TestIssueSnapshot[];
  now: string;
}

export function resolveGreenBaseline(input: ResolveGreenBaselineInput): GreenBaseline {
  const evidence = input.last_evidence;
  if (
    evidence !== null &&
    evidence.overall_status === 'pass' &&
    !input.tree_changed_since_evidence
  ) {
    const source: GreenBaselineSource = 'reused-evidence';
    return {
      captured_at: input.now,
      source,
      issues: evidence.issues,
    };
  }

  return {
    captured_at: input.now,
    source: 'rerun',
    issues: input.rerun(),
  };
}

export function detectRegression(
  baseline: TestIssueSnapshot[],
  afterFix: TestIssueSnapshot[],
): RegressionVerdict {
  const { delta } = createTestDelta(baseline, afterFix, {
    treat_missing_as_passing: true,
  });

  return {
    regressed: delta.newly_failing_tests.length > 0 || delta.newly_errored_tests.length > 0,
    newly_failing: delta.newly_failing_tests,
    newly_errored: delta.newly_errored_tests,
  };
}
