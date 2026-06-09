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
  'extension-surface',
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
  // Issue #105 — mutation-testing signal for the changed code. Optional: the
  // gate is inert when absent (fast lane, no mutation tool, etc.).
  mutation_result?: MutationResult;
  // When true, surviving behaviour-changing mutants hard-fail the mutation gate
  // instead of escalating. Project-tunable; defaults to escalate.
  mutation_strict?: boolean;
  // Issue #110 — quality-ratchet signal for this run (four measures vs. the
  // recorded baseline). Optional: the gate is inert when absent (fast lane with
  // nothing to compare, no baseline yet, etc.).
  quality_ratchet_result?: QualityRatchetResult;
  // The active routing lane, used to keep mutation light on the fast lane.
  lane?: Lane;
  expected_ui_modules: string[];
  expected_api_modules: string[];
  expected_integration_modules: string[];
  expected_error_catalog_modules: string[];
  registry_refreshed_at: string | null;
  glossary_updated: boolean;
}
