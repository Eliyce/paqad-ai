import type { TestIssueSnapshot } from './token-efficiency.js';
import type { VerificationEvidenceFailure } from './verification-evidence.js';

export const REGRESSION_GUARD_SCHEMA_VERSION = '1.0.0' as const;

export type DefectId = string;

export const DEFECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ProofCheck {
  test_file: string;
  test_id: string;
  command: string;
  expected_failure_signal?: string;
}

export interface ProofRunResult {
  passed: boolean;
  output: string;
}

export interface ProofGenuinenessVerdict {
  genuine: boolean;
  reason: string;
}

export interface FixChangedFile {
  path: string;
  added_lines: string[];
  removed_lines: string[];
}

export interface FixChange {
  files: FixChangedFile[];
}

export interface AffectsBehaviourVerdict {
  affects: boolean;
  reason: string;
  behavioural_evidence: string[];
}

export type GreenBaselineSource = 'reused-evidence' | 'rerun';

export interface GreenBaseline {
  captured_at: string;
  source: GreenBaselineSource;
  issues: TestIssueSnapshot[];
}

export interface RegressionVerdict {
  regressed: boolean;
  newly_failing: string[];
  newly_errored: string[];
}

export interface RegressionGuard {
  schema_version: typeof REGRESSION_GUARD_SCHEMA_VERSION;
  defect_id: DefectId;
  created_at: string;
  proof: {
    test_id: string;
    test_file: string;
    command: string;
  };
  failing_evidence: VerificationEvidenceFailure;
  linked_ac_id: string | null;
}

export type FixProtocolStatus =
  | 'skipped-no-behaviour-change'
  | 'rejected-proof-not-genuine'
  | 'rejected-proof-still-failing'
  | 'rejected-regression'
  | 'fixed';

export interface FixProtocolResult {
  status: FixProtocolStatus;
  reason: string;
  affects_behaviour: AffectsBehaviourVerdict;
  proof_genuine?: ProofGenuinenessVerdict;
  regression?: RegressionVerdict;
  guard_path?: string;
}
