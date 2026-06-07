import type {
  FeatureSpec,
  FrozenSpecMetadata,
  SpecFreezeEvaluation,
} from '@/core/types/feature-spec.js';
import type { SpecReviewReport } from '@/compliance/types.js';

export interface FreezeSpecInput {
  signed_off_by: string;
  frozen_at: string;
  spec_review?: SpecReviewReport | null;
}

/**
 * Decides whether a spec may be frozen. A spec freezes only when it carries all
 * three machine-checkable sections (behaviour, acceptance criteria, invariants),
 * every acceptance criterion declares a proof target, no open questions remain,
 * every invariant is human-confirmed, and no *critical* spec-review defect is
 * still open (issue #102 — "done" stops being a feeling).
 */
export function evaluateSpecFreeze(
  spec: FeatureSpec,
  specReview?: SpecReviewReport | null,
): SpecFreezeEvaluation {
  const blockers: string[] = [];

  if (spec.behaviour.length === 0) {
    blockers.push('Spec has no behaviour statements.');
  }
  if (spec.acceptance_criteria.length === 0) {
    blockers.push('Spec has no acceptance criteria.');
  }
  if (spec.invariants.length === 0) {
    blockers.push('Spec has no invariants.');
  }

  for (const criterion of spec.acceptance_criteria) {
    if (!criterion.proof_type) {
      blockers.push(`Acceptance criterion ${criterion.criterion_id} has no proof_type.`);
    }
  }

  for (const invariant of spec.invariants) {
    if (!invariant.confirmed) {
      blockers.push(`Invariant ${invariant.invariant_id} is not human-confirmed.`);
    }
  }

  for (const question of spec.open_questions) {
    blockers.push(`Open question unresolved: ${question}`);
  }

  if (specReview) {
    for (const defect of specReview.defects) {
      if (defect.severity === 'critical' && defect.status !== 'resolved') {
        blockers.push(`Critical spec-review defect open: ${defect.defect_id}`);
      }
    }
  }

  return { can_freeze: blockers.length === 0, blockers };
}

/**
 * Freezes a freshly-built spec, stamping the sign-off metadata. The spec must be
 * rebuilt from the markdown before calling this (the sidecar is never
 * hand-maintained), so `spec.spec_hash` already pins the current source. Throws
 * when {@link evaluateSpecFreeze} reports blockers — a spec is never frozen
 * silently over unresolved questions or contradictions.
 */
export function freezeSpec(spec: FeatureSpec, input: FreezeSpecInput): FeatureSpec {
  const evaluation = evaluateSpecFreeze(spec, input.spec_review);
  if (!evaluation.can_freeze) {
    throw new Error(`Cannot freeze spec ${spec.spec_id}: ${evaluation.blockers.join('; ')}`);
  }

  const frozen: FrozenSpecMetadata = {
    frozen_at: input.frozen_at,
    spec_hash: spec.spec_hash,
    signed_off_by: input.signed_off_by,
  };

  return { ...spec, frozen };
}

/**
 * Detects whether a frozen spec's source markdown has changed since freeze.
 * A mismatch means the spec must be re-confirmed and re-frozen (or a
 * `spec.change` Decision Pause raised) before development continues.
 */
export function isFrozenSpecStale(spec: FeatureSpec, currentSpecHash: string): boolean {
  return spec.frozen !== null && spec.frozen.spec_hash !== currentSpecHash;
}
