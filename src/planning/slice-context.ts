import type {
  ExistingImplementation,
  PlanningManifest,
  PriorSliceSummary,
  SliceContext,
} from '@/core/types/planning.js';

export function assembleSliceContext(input: {
  manifest: PlanningManifest;
  sliceId: string;
  priorSlices: PriorSliceSummary[];
  existingImplementations?: ExistingImplementation[];
  tokenBudget: number;
}): SliceContext {
  const slice = input.manifest.execution_slices.find(
    (candidate) => candidate.slice_id === input.sliceId,
  );
  if (!slice) {
    throw new Error(`Unknown execution slice: ${input.sliceId}`);
  }

  const coveredIds = new Set(slice.covers);
  return {
    manifest_header: {
      plan_version: input.manifest.plan_version,
      plan_mode: input.manifest.plan_mode,
      feature_id: input.manifest.feature_id,
      slug: input.manifest.slug,
      created_at: input.manifest.created_at,
      classification: input.manifest.classification,
    },
    current_slice: slice,
    verification_criteria: input.manifest.verification_matrix.filter(
      (criterion) =>
        coveredIds.has(criterion.criterion_id) ||
        criterion.linked_requirement_ids.some((requirementId) => coveredIds.has(requirementId)),
    ),
    test_skeletons: input.manifest.verification_matrix
      .filter(
        (criterion) =>
          criterion.proof_type === 'automated' &&
          criterion.proof_target &&
          (coveredIds.has(criterion.criterion_id) ||
            criterion.linked_requirement_ids.some((requirementId) =>
              coveredIds.has(requirementId),
            )),
      )
      .map((criterion) => criterion.proof_target!)
      .filter((target, index, all) => all.indexOf(target) === index),
    doc_targets: input.manifest.doc_targets.filter((target) => target.slice_id === slice.slice_id),
    regression_entries: input.manifest.regression_watch.filter(
      (entry) => entry.slice_id === slice.slice_id,
    ),
    prior_slices: input.priorSlices,
    existing_code_matches: (input.existingImplementations ?? []).filter((candidate) =>
      slice.touches.includes(candidate.file_path),
    ),
    decision_context: input.manifest.decision_log.filter((decision) =>
      decision.linked_requirements.some((requirementId) => coveredIds.has(requirementId)),
    ),
    token_budget: input.tokenBudget,
  };
}
