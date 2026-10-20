import type { StructuredTestResult } from './test-output.js';
import type { Lane } from './routing.js';
import type { MutationResult } from './mutation.js';
import type { QualityRatchetResult } from './quality-ratchet.js';

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
  'mutation-testing',
  'quality-ratchet',
  'database-quality',
  'module-docs-structure',
  'instructions-docs-structure',
  'documentation-freshness',
  'site-map-freshness',
  'extension-surface',
  'duplication',
] as const;
export type VerificationGate = (typeof VERIFICATION_GATES)[number];

export type GateSkipKind = 'not-required' | 'did-not-run';

export interface GateResult {
  gate: VerificationGate;
  passed: boolean;
  inconclusive?: boolean;
  outcome?: GateSkipKind;
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

export interface WaitingDecision {
  decision_id: string;
  category: string;
  question: string;
}

export type CanonicalDocOwnershipKind = 'direct-doc-edit' | 'implementation-drift';

export interface CanonicalDocTarget {
  target_path: string;
  ownership_kind: CanonicalDocOwnershipKind;
  owners: string[];
  reason: string;
}

export type VerificationOrigin =
  | 'provider-workflow'
  | 'paqad-cli'
  | 'hook-completion'
  | 'git-backstop'
  | 'ci-backstop'
  | 'unknown';

export const BACKSTOP_VERIFICATION_ORIGINS = [
  'hook-completion',
  'git-backstop',
  'ci-backstop',
] as const satisfies readonly VerificationOrigin[];

export function isBackstopVerificationOrigin(
  origin: VerificationOrigin | undefined,
): origin is (typeof BACKSTOP_VERIFICATION_ORIGINS)[number] {
  return (
    origin !== undefined && (BACKSTOP_VERIFICATION_ORIGINS as readonly string[]).includes(origin)
  );
}

export interface VerificationContext {
  project_root: string;
  verification_origin?: VerificationOrigin;
  verification_stage?: 'provider-completion' | 'backstop-completion' | 'other';
  modules: string[];
  changed_files: string[];
  changed_files_source: 'git' | 'none';
  spec_boundary?: string[];
  code_changed: boolean;
  test_files_changed: boolean;
  documentation_files_changed: boolean;
  stale_doc_targets: CanonicalDocTarget[];
  requirements_complete: boolean;
  story_quality_passed: boolean;
  ac_test_mapping_passed: boolean;
  ac_test_mapping_detail?: string;
  ac_test_mapping_outcome?: 'pass' | 'fail' | 'not-required' | 'did-not-run';
  spec_review_passed: boolean;
  architecture_compliant: boolean;
  code_tests_lint_passed: boolean;
  implementation_review_passed: boolean;
  implementation_review_findings?: ImplementationReviewFinding[];
  waiting_decisions?: WaitingDecision[];
  behavioral_correctness_passed: boolean;
  database_quality_passed: boolean;
  structured_test_results?: StructuredTestResult[];
  mutation_result?: MutationResult;
  mutation_note?: string;
  mutation_strict?: boolean;
  quality_ratchet_result?: QualityRatchetResult;
  lane?: Lane;
  expected_ui_modules: string[];
  expected_api_modules: string[];
  expected_integration_modules: string[];
  expected_error_catalog_modules: string[];
  registry_refreshed_at: string | null;
  glossary_updated: boolean;
}
