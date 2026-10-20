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

/**
 * Issue #639, Part 10 — why a gate measured nothing. `not-required` means the change gave the
 * gate nothing to check (no instruction doc changed, mutation is off); `did-not-run` means the
 * gate was owed a check that did not happen (the mutation tool is not configured, every ratchet
 * measure was blocked). Recorded on evidence gates and ledger rows as `skip_kind` beside the
 * existing `skipped` status (decision D-01M5AM0E9YEC7FBFHFN8N3SHCC).
 */
export type GateSkipKind = 'not-required' | 'did-not-run';

export interface GateResult {
  gate: VerificationGate;
  passed: boolean;
  inconclusive?: boolean;
  /**
   * Issue #639, Part 10 — set when the gate measured nothing. The result keeps `passed: true`
   * so the gate runner never treats it as the first failure and no verdict kind changes; the
   * evidence records it as `skipped` with this as its `skip_kind`, never as a pass.
   */
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

/**
 * Where a verification run was fired from. `provider-workflow` is the in-session
 * path driven by the host agent following the feature-development workflow.
 *
 * Issue #117 adds the binding, agent-independent origins: a `Stop`/completion
 * hook (`hook-completion`) and the git/CI backstop (`git-backstop`,
 * `ci-backstop`). These let a run that fires automatically — not at the agent's
 * discretion — be told apart from the skippable in-workflow path.
 */
export type VerificationOrigin =
  | 'provider-workflow'
  | 'paqad-cli'
  | 'hook-completion'
  | 'git-backstop'
  | 'ci-backstop'
  | 'unknown';

/**
 * The set of {@link VerificationOrigin}s fired automatically by a hook or the
 * git/CI backstop (issue #117), as opposed to the in-session provider workflow.
 * A run with one of these origins evaluated the gates against repository
 * reality, independent of whether the agent chose to run the workflow phase.
 */
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
  /**
   * Issue #117 (C-4) — the path prefixes a change is allowed to touch, derived
   * from the frozen spec boundary and the attributed modules
   * (`classification.affected_modules` / `module-map.yml`). When set and
   * non-empty, the `change-completeness` gate flags `changed_files` outside the
   * boundary as a blocking scope-drift finding. Left undefined on the in-session
   * provider path, where scope is governed live by the workflow.
   */
  spec_boundary?: string[];
  code_changed: boolean;
  test_files_changed: boolean;
  documentation_files_changed: boolean;
  stale_doc_targets: CanonicalDocTarget[];
  requirements_complete: boolean;
  story_quality_passed: boolean;
  ac_test_mapping_passed: boolean;
  /**
   * Issue #117 (C-2) — the computed, specific detail behind
   * `ac_test_mapping_passed` (e.g. "Acceptance criteria with no proving check:
   * AC-2"). When set, the `ac-test-mapping` gate surfaces it so the trust
   * verdict names the exact unmapped criterion instead of a generic message.
   */
  ac_test_mapping_detail?: string;
  /**
   * Issue #639, Part 11 — which of the four honest readings the context builder computed
   * from the change-scoped map. `not-required` (no frozen spec, or only visual/manual
   * criteria) and `did-not-run` (a frozen spec but no map) keep `ac_test_mapping_passed`
   * true and make the gate record a skip; `pass` and `fail` are real measurements.
   */
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
  // Issue #105 — mutation-testing signal for the changed code. Optional: the
  // gate reads not required when absent (mutation off, fast lane, etc.).
  mutation_result?: MutationResult;
  // Issue #639, Part 10 — why mutation did not run when `mutation_result` is absent, in plain
  // words. The mutation gate uses it as its not-required detail; absent reads as mutation off.
  mutation_note?: string;
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
