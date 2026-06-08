import type { VerificationCriterion } from './planning.js';

/**
 * Where an invariant ("a rule the feature must never break") came from. Compiled
 * rules and module business rules are auto-suggested at spec-build time; the
 * human can also author one directly. Every invariant must be human-confirmed
 * before the spec can be frozen (issue #102, Open Decision 2).
 */
export type FeatureSpecInvariantSource = 'compiled-rule' | 'module-rule' | 'authored';

export interface FeatureSpecInvariant {
  invariant_id: string;
  statement: string;
  source: FeatureSpecInvariantSource;
  rule_id?: string;
  confirmed: boolean;
}

/**
 * Snapshot written when a spec is frozen. `spec_hash` pins the exact source
 * markdown the freeze signed off on, so any later edit to the markdown is
 * detectable as drift.
 */
export interface FrozenSpecMetadata {
  frozen_at: string;
  spec_hash: string;
  signed_off_by: string;
}

/**
 * The structured, machine-checkable sidecar generated from a human-readable
 * `.paqad/specs/S-<id>-<slug>.md`. It is rebuilt from the markdown on every
 * freeze (never hand-maintained) so it cannot drift from the source of truth.
 */
export interface FeatureSpec {
  schema_version: string;
  spec_id: string;
  spec_file: string;
  spec_hash: string;
  behaviour: string[];
  acceptance_criteria: VerificationCriterion[];
  invariants: FeatureSpecInvariant[];
  open_questions: string[];
  frozen: FrozenSpecMetadata | null;
}

/**
 * Result of checking whether a spec may be frozen. `can_freeze` is true only
 * when `blockers` is empty.
 */
export interface SpecFreezeEvaluation {
  can_freeze: boolean;
  blockers: string[];
}

/** A single acceptance criterion paired with whether its proof currently passes. */
export interface DoneCriterionState {
  criterion_id: string;
  proof_passing: boolean;
}

/**
 * A self-review / triage finding. `kind: 'taste'` findings are style/taste and
 * never block "done" (issue #102 — style/taste never blocks). Any other kind
 * blocks only once it is `confirmed`.
 */
export interface DoneFinding {
  id: string;
  kind: string;
  confirmed: boolean;
}

export interface DoneInput {
  gates_passed: boolean;
  acceptance_criteria: DoneCriterionState[];
  findings: DoneFinding[];
}

export interface DoneResult {
  done: boolean;
  gates_passed: boolean;
  failing_criteria: string[];
  blocking_findings: string[];
}
