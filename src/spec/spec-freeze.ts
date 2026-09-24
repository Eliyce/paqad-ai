import type {
  FeatureSpec,
  FrozenSpecMetadata,
  SpecFreezeEvaluation,
  SpecProvenance,
  SpecReviewSummary,
} from '@/core/types/feature-spec.js';
import type { SpecReviewReport } from '@/compliance/types.js';

/** Extra freeze requirements that depend on the change, not the spec text. */
export interface SpecFreezeOptions {
  /** Issue #579 — set when visual evidence is on and these frontend files are in the change. */
  requireVisualAc?: { files: string[] };
}

export interface FreezeSpecInput {
  signed_off_by: string;
  frozen_at: string;
  spec_review?: SpecReviewReport | null;
  /**
   * How the spec was produced (issue #547, FR-9.1). Copied verbatim into the frozen record when
   * present; absent for a spec frozen with the pipeline off, so the record stays byte-identical to
   * a pre-#547 freeze.
   */
  provenance?: SpecProvenance;
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
  options: SpecFreezeOptions = {},
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

  // Issue #579 (FR-14) — a frontend change under visual evidence must say which criterion the
  // screenshots prove, or the evidence has nothing to be checked against.
  const visual = options.requireVisualAc;
  if (visual && !spec.acceptance_criteria.some((criterion) => criterion.proof_type === 'visual')) {
    blockers.push(
      `Visual evidence is on and this change touches frontend files (${visual.files.join(', ')}), so at least one acceptance criterion needs (proof: visual).`,
    );
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

  // Issue #401 — the review that gated this freeze is folded into the record it produced,
  // so the evidence travels with the spec of record. Before this, the only way to see what
  // the review found was a separate `.paqad/compliance/<slug>/spec-review.json` the agent
  // had to generate by hand, which is the stray artifact this issue was filed over.
  const specReview = input.spec_review ? summarizeSpecReview(input.spec_review) : undefined;

  return {
    ...spec,
    frozen,
    ...(specReview === undefined ? {} : { spec_review: specReview }),
    // Issue #547 — carry the pipeline provenance into the record of truth when the freeze was
    // handed one. Absent ⇒ no `provenance` key, so a non-pipeline freeze is unchanged (INV-9).
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  };
}

/**
 * Condenses a full review report to the counts worth keeping in the frozen record.
 * Resolved defects are excluded, matching {@link evaluateSpecFreeze}, which only blocks on
 * a critical defect that is still open.
 */
function summarizeSpecReview(report: SpecReviewReport): SpecReviewSummary {
  const open = report.defects.filter((defect) => defect.status !== 'resolved');
  return {
    reviewed_at: report.metadata.reviewed_at,
    defect_count: open.length,
    by_severity: {
      critical: open.filter((defect) => defect.severity === 'critical').length,
      major: open.filter((defect) => defect.severity === 'major').length,
      minor: open.filter((defect) => defect.severity === 'minor').length,
    },
  };
}

/**
 * Detects whether a frozen spec's source markdown has changed since freeze.
 * A mismatch means the spec must be re-confirmed and re-frozen (or a
 * `spec.change` Decision Pause raised) before development continues.
 */
export function isFrozenSpecStale(spec: FeatureSpec, currentSpecHash: string): boolean {
  return spec.frozen !== null && spec.frozen.spec_hash !== currentSpecHash;
}
