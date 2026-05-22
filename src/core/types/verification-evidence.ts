import type { VerificationGate } from './verification.js';

export const VERIFICATION_EVIDENCE_SCHEMA_VERSION = '1.0.0';

export const EVIDENCE_GATE_STATUSES = ['pass', 'fail', 'inconclusive', 'skipped'] as const;
export type EvidenceGateStatus = (typeof EVIDENCE_GATE_STATUSES)[number];

export const EVIDENCE_OVERALL_STATUSES = ['pass', 'fail', 'error'] as const;
export type EvidenceOverallStatus = (typeof EVIDENCE_OVERALL_STATUSES)[number];

export const EVIDENCE_FAILURE_CATEGORIES = [
  'test-failure',
  'test-error',
  'test-timeout',
  'gate-failure',
] as const;
export type EvidenceFailureCategory = (typeof EVIDENCE_FAILURE_CATEGORIES)[number];

export interface VerificationEvidenceFailure {
  category: EvidenceFailureCategory;
  file: string | null;
  line: number | null;
  test_id: string | null;
  suite: string | null;
  ac_id: string | null;
  message: string;
  stderr_excerpt: string | null;
}

export interface VerificationEvidenceGate {
  name: VerificationGate;
  status: EvidenceGateStatus;
  detail: string;
  remediation: string | null;
  failures: VerificationEvidenceFailure[];
}

export interface VerificationEvidence {
  schema_version: typeof VERIFICATION_EVIDENCE_SCHEMA_VERSION;
  run_id: string;
  started_at: string;
  completed_at: string;
  overall_status: EvidenceOverallStatus;
  first_failure_gate: VerificationGate | null;
  gates: VerificationEvidenceGate[];
}
