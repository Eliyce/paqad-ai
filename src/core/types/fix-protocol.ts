import type { TestIssueSnapshot } from './token-efficiency.js';
import type { VerificationEvidenceFailure } from './verification-evidence.js';

/** Schema version for the persisted regression-guard sidecar. */
export const REGRESSION_GUARD_SCHEMA_VERSION = '1.0.0' as const;

/**
 * A stable identifier for a confirmed defect a fix addresses. It keys the
 * persisted regression guard so the same defect cannot silently return.
 * Constrained to a filename-safe slug — it becomes part of a path.
 */
export type DefectId = string;

/** Matches a filename-safe defect id (no separators, no traversal). */
export const DEFECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * A single automated check that proves one specific defect exists. It is the
 * committed test that reproduces the bug; the same check is later kept as a
 * regression guard.
 */
export interface ProofCheck {
  /** The committed test file that reproduces the defect. */
  test_file: string;
  /** Stable id of the test within the suite (matches `StructuredTestIssue.test_id`). */
  test_id: string;
  /** Tool-agnostic command that runs just this proof. */
  command: string;
  /**
   * Optional substring the failing output must contain for the proof to count
   * as genuinely targeting the reported defect (guards against a proof that
   * fails for an unrelated reason).
   */
  expected_failure_signal?: string;
}

/** Outcome of running a proof check once. */
export interface ProofRunResult {
  passed: boolean;
  /** Combined stdout/stderr excerpt, used to confirm the failure targets the defect. */
  output: string;
}

/** Verdict on whether a proof genuinely reproduces the defect. */
export interface ProofGenuinenessVerdict {
  genuine: boolean;
  reason: string;
}

/** A single file touched by a fix, with the lines that changed. */
export interface FixChangedFile {
  path: string;
  added_lines: string[];
  removed_lines: string[];
}

/** The set of edits a single fix makes — the input to the behaviour classifier. */
export interface FixChange {
  files: FixChangedFile[];
}

/** Verdict on whether a change can affect runtime behaviour. */
export interface AffectsBehaviourVerdict {
  affects: boolean;
  reason: string;
  /** Files (and a sample changed line) that forced a behaviour-affecting verdict. */
  behavioural_evidence: string[];
}

/** Where a green baseline came from (open decision #1). */
export type GreenBaselineSource = 'reused-evidence' | 'rerun';

/**
 * The pre-fix suite snapshot a regression check compares against. A green
 * baseline carries the failing/errored issues that existed *before* the fix
 * (empty when the suite was fully green), expressed as issue snapshots so the
 * existing delta projection can be reused — no parallel result store.
 */
export interface GreenBaseline {
  captured_at: string;
  source: GreenBaselineSource;
  issues: TestIssueSnapshot[];
}

/** Outcome of comparing the post-fix suite against the green baseline. */
export interface RegressionVerdict {
  regressed: boolean;
  newly_failing: string[];
  newly_errored: string[];
}

/**
 * The persisted "proof is kept" artifact: a durable regression guard linking a
 * `defect_id` to its committed proof test and the captured failing evidence.
 */
export interface RegressionGuard {
  schema_version: typeof REGRESSION_GUARD_SCHEMA_VERSION;
  defect_id: DefectId;
  created_at: string;
  proof: {
    test_id: string;
    test_file: string;
    command: string;
  };
  /** The pre-fix failing evidence (reuses the verification-evidence failure shape). */
  failing_evidence: VerificationEvidenceFailure;
  linked_ac_id: string | null;
}

/** Terminal status of one run of the fix protocol. */
export type FixProtocolStatus =
  | 'skipped-no-behaviour-change'
  | 'rejected-proof-not-genuine'
  | 'rejected-proof-still-failing'
  | 'rejected-regression'
  | 'fixed';

/** Structured outcome of running the fix protocol for one fix. */
export interface FixProtocolResult {
  status: FixProtocolStatus;
  reason: string;
  affects_behaviour: AffectsBehaviourVerdict;
  proof_genuine?: ProofGenuinenessVerdict;
  regression?: RegressionVerdict;
  guard_path?: string;
}
