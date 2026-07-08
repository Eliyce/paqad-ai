// Stage registry for the stage-evidence ledger (issue #247).
//
// The ordered universe of feature-development stages is derived from the ONE
// canonical source — `STAGE_ORDER` in the feature-development policy — so the
// ledger's ordering checks can never drift from the workflow the agent runs.

import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';

/** The ordered stage ids, lowest index first (planning before development, …). */
export const STAGE_EVIDENCE_STAGES: readonly string[] = [...STAGE_ORDER];

export type StageId = (typeof STAGE_ORDER)[number];

/**
 * Stages mandatory for an applicable code change. `ticket_intake` (intake-only)
 * and `delivery` (post-merge) are optional bookends, so a change is "complete"
 * without them. The mandatory set is what the end-of-change verify gate enforces.
 */
export const MANDATORY_STAGES: readonly StageId[] = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

/**
 * The mandatory stages that must run BEFORE any code is written — `planning` and
 * `specification`. Derived from ONE place (the `development` boundary in
 * MANDATORY_STAGES) so the block-forward gate's precondition (capability.ts) and the
 * live writer's defer condition (live-writer.ts, issue #310) can never drift.
 */
export const PRE_CODE_STAGES: readonly StageId[] = MANDATORY_STAGES.slice(
  0,
  MANDATORY_STAGES.indexOf('development'),
);

/**
 * Completion-anchored stages (issue #270). A stage whose canonical position is the
 * completion boundary — recorded from the agent's `paqad:stage` marker and confirmed
 * at the completion (finalize) seam, never subject to forward-ordering.
 *
 * `review` is the sole member: it is edit-less (the live writer can never stamp it)
 * AND canonically precedes the edit-bearing stages (`checks`, `documentation_sync`)
 * that the live writer DOES stamp during the build. So an honest review of the
 * finished diff necessarily lands after them in wall-clock time. Anchoring it to
 * completion — rather than a fixed slot before `checks` — is what lets a truthful
 * late review record and pass. The honesty floor is untouched: a review that is
 * never marked is still `missing` (see fold's completeness check), so this forgives
 * ordering, never absence.
 */
export const COMPLETION_ANCHORED_STAGES: readonly StageId[] = ['review'];

/** True when `stage` is a known stage id. */
export function isKnownStage(stage: string): stage is StageId {
  return (STAGE_EVIDENCE_STAGES as readonly string[]).includes(stage);
}

/**
 * True when `stage` is completion-anchored (see {@link COMPLETION_ANCHORED_STAGES}):
 * exempt from forward-ordering because its natural position is the completion
 * boundary, after every edit-bearing stage.
 */
export function isCompletionAnchoredStage(stage: string): boolean {
  return (COMPLETION_ANCHORED_STAGES as readonly string[]).includes(stage);
}

/** True when `stage` is mandatory for an applicable code change. */
export function isMandatoryStage(stage: string): boolean {
  return (MANDATORY_STAGES as readonly string[]).includes(stage);
}

/** Position of `stage` in the canonical order, or -1 when unknown. */
export function stageIndex(stage: string): number {
  return STAGE_EVIDENCE_STAGES.indexOf(stage);
}
