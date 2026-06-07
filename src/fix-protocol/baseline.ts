import type {
  GreenBaseline,
  GreenBaselineSource,
  RegressionVerdict,
} from '@/core/types/fix-protocol.js';
import type { TestIssueSnapshot } from '@/core/types/token-efficiency.js';
import type { EvidenceOverallStatus } from '@/core/types/verification-evidence.js';
import { createTestDelta } from '@/token-efficiency/index.js';

/** The slice of verification evidence a baseline can be reused from. */
export interface BaselineEvidenceSummary {
  overall_status: EvidenceOverallStatus;
  /** Issue snapshots (failing/errored) the evidence recorded. Empty when green. */
  issues: TestIssueSnapshot[];
}

export interface ResolveGreenBaselineInput {
  /** The last verification-evidence summary, if one exists for this session. */
  last_evidence: BaselineEvidenceSummary | null;
  /**
   * Whether the working tree changed since `last_evidence` was produced. A
   * changed tree forces a fresh re-run — stale evidence cannot be trusted as a
   * baseline (open decision #1).
   */
  tree_changed_since_evidence: boolean;
  /** Re-runs the full suite on the current tree and returns its issue snapshots. */
  rerun: () => TestIssueSnapshot[];
  /** ISO timestamp to stamp on the resolved baseline. */
  now: string;
}

/**
 * Resolves the green baseline a regression check compares against. It reuses
 * the last passing evidence when that evidence is fresh (the tree has not
 * changed since), and otherwise re-runs the suite. A non-passing or missing
 * evidence, or a changed tree, always forces a re-run (open decision #1:
 * reuse-last-green-if-fresh, else re-run).
 */
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
      // A passing evidence carries no failing issues; reuse whatever it recorded.
      issues: evidence.issues,
    };
  }

  return {
    captured_at: input.now,
    source: 'rerun',
    issues: input.rerun(),
  };
}

/**
 * Compares the post-fix suite against the green baseline using the existing
 * delta projection (`createTestDelta`) — no parallel result store. A regression
 * is any check that was not failing/errored in the baseline but is now: a
 * previously-passing check that the fix broke. The once-failing proof is never
 * counted (it moves into passing, surfacing as `newly_passing`).
 */
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
