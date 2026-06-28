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

/** True when `stage` is a known stage id. */
export function isKnownStage(stage: string): stage is StageId {
  return (STAGE_EVIDENCE_STAGES as readonly string[]).includes(stage);
}

/** True when `stage` is mandatory for an applicable code change. */
export function isMandatoryStage(stage: string): boolean {
  return (MANDATORY_STAGES as readonly string[]).includes(stage);
}

/** Position of `stage` in the canonical order, or -1 when unknown. */
export function stageIndex(stage: string): number {
  return STAGE_EVIDENCE_STAGES.indexOf(stage);
}
