import type {
  FeatureSpec,
  FrozenSpecMetadata,
  SpecFreezeEvaluation,
  SpecGroundingSection,
  SpecPipelineSection,
  SpecReviewSummary,
  SpecTaskSection,
  SpecTraceMap,
} from '@/core/types/feature-spec.js';
import type { SpecReviewReport } from '@/compliance/types.js';

export interface SpecFreezeOptions {
  requireVisualAc?: { files: string[] };
}

export interface FreezeSpecInput {
  signed_off_by: string;
  frozen_at: string;
  spec_review?: SpecReviewReport | null;
  sections?: {
    task?: SpecTaskSection;
    grounding?: SpecGroundingSection;
    pipeline?: SpecPipelineSection;
    trace?: SpecTraceMap;
  };
}

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

  const specReview = input.spec_review ? summarizeSpecReview(input.spec_review) : undefined;

  return {
    ...spec,
    frozen,
    ...(specReview === undefined ? {} : { spec_review: specReview }),
    ...(input.sections?.task === undefined ? {} : { task: input.sections.task }),
    ...(input.sections?.grounding === undefined ? {} : { grounding: input.sections.grounding }),
    ...(input.sections?.pipeline === undefined ? {} : { pipeline: input.sections.pipeline }),
    ...(input.sections?.trace === undefined ? {} : { trace: input.sections.trace }),
  };
}

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

export function isFrozenSpecStale(spec: FeatureSpec, currentSpecHash: string): boolean {
  return spec.frozen !== null && spec.frozen.spec_hash !== currentSpecHash;
}
