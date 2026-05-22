import type { StructuredTestResult } from './test-output.js';

export const VERIFICATION_GATES = [
  'change-completeness',
  'requirement-completeness',
  'story-quality',
  'ac-test-mapping',
  'spec-review',
  'architecture-compliance',
  'code-tests-lint',
  'implementation-review',
  'behavioral-correctness',
  'database-quality',
  'module-docs-structure',
  'instructions-docs-structure',
  'documentation-freshness',
] as const;
export type VerificationGate = (typeof VERIFICATION_GATES)[number];

export interface GateResult {
  gate: VerificationGate;
  passed: boolean;
  inconclusive?: boolean;
  detail: string;
  remediation?: string;
}

export interface ImplementationReviewFinding {
  kind: 'decision-violation' | 'undeclared-decision';
  severity: 'error' | 'warning';
  detail: string;
  decision_id?: string;
  file?: string;
}

export type CanonicalDocOwnershipKind = 'direct-doc-edit' | 'implementation-drift';

export interface CanonicalDocTarget {
  target_path: string;
  ownership_kind: CanonicalDocOwnershipKind;
  owners: string[];
  reason: string;
}

export interface VerificationContext {
  project_root: string;
  verification_origin?: 'provider-workflow' | 'paqad-cli' | 'unknown';
  verification_stage?: 'provider-completion' | 'other';
  modules: string[];
  changed_files: string[];
  changed_files_source: 'session-artifact' | 'git-status' | 'none';
  code_changed: boolean;
  test_files_changed: boolean;
  documentation_files_changed: boolean;
  stale_doc_targets: CanonicalDocTarget[];
  requirements_complete: boolean;
  story_quality_passed: boolean;
  ac_test_mapping_passed: boolean;
  spec_review_passed: boolean;
  architecture_compliant: boolean;
  code_tests_lint_passed: boolean;
  implementation_review_passed: boolean;
  implementation_review_findings?: ImplementationReviewFinding[];
  behavioral_correctness_passed: boolean;
  database_quality_passed: boolean;
  structured_test_results?: StructuredTestResult[];
  expected_ui_modules: string[];
  expected_api_modules: string[];
  expected_integration_modules: string[];
  expected_error_catalog_modules: string[];
  registry_refreshed_at: string | null;
  glossary_updated: boolean;
}
