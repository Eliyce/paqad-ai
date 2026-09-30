// Discovery stage registry (issue #597).
//
// The six Discovery stages, in canonical order. Deliberately SEPARATE from the feature-development
// STAGE_ORDER: the stage-evidence recorder throws on a foreign stage, and extending STAGE_ORDER
// would pollute the feature-dev completion gate. Discovery records its own stages on the generic
// session-ledger substrate (see recorder.ts) with its own doc type, so the two never interfere.
//
// Every Discovery stage is a "thinking" stage — none edits source — so each must prove its work
// with a real, non-empty canonical artifact (DW-04, DW-08). A bare start/end marker pair with no
// artifact folds inconclusive, exactly as the feature-dev thinking stages do.

import type { DiscoveryDocType } from './types.js';
import { DISCOVERY_DOC_TYPES } from './types.js';

/** The ordered Discovery stage ids, lowest index first. */
export const DISCOVERY_STAGE_ORDER = [
  'understand',
  'investigate',
  'refine',
  'decide',
  'check_readiness',
  'hand_off',
] as const;

export type DiscoveryStageId = (typeof DISCOVERY_STAGE_ORDER)[number];

/**
 * Every Discovery stage is mandatory for a complete run (DW-04: "All six responsibilities are
 * mandatory"). The completion verdict fails a run missing any of them.
 */
export const MANDATORY_DISCOVERY_STAGES: readonly DiscoveryStageId[] = [...DISCOVERY_STAGE_ORDER];

/**
 * The canonical artifact each stage's `end` must reference to count as done. Because every stage is
 * a thinking stage, this is the full set — a stage ended with no artifact (or an empty one) folds
 * inconclusive. The value is the artifact's Discovery doc type, so the recorder can check that the
 * referenced file is the RIGHT artifact for the stage (a wrong-stage artifact is rejected, DW-08).
 */
const STAGE_ARTIFACT: Readonly<Record<DiscoveryStageId, DiscoveryDocType>> = {
  understand: DISCOVERY_DOC_TYPES.brief,
  investigate: DISCOVERY_DOC_TYPES.source,
  refine: DISCOVERY_DOC_TYPES.synthesis,
  decide: DISCOVERY_DOC_TYPES.decisions,
  check_readiness: DISCOVERY_DOC_TYPES.readiness,
  hand_off: DISCOVERY_DOC_TYPES.handoff,
} as const;

/** True when `stage` is one of the six Discovery stages. */
export function isKnownDiscoveryStage(stage: string): stage is DiscoveryStageId {
  return (DISCOVERY_STAGE_ORDER as readonly string[]).includes(stage);
}

/** True when `stage` is mandatory for a complete run (all six are). */
export function isMandatoryDiscoveryStage(stage: string): stage is DiscoveryStageId {
  return (MANDATORY_DISCOVERY_STAGES as readonly string[]).includes(stage);
}

/**
 * The canonical position of `stage` in the order, or -1 when unknown. The fold uses this as the
 * single ordering judge (a later stage may not start before an earlier one has ended).
 */
export function discoveryStageIndex(stage: string): number {
  return (DISCOVERY_STAGE_ORDER as readonly string[]).indexOf(stage);
}

/** The Discovery doc type of the artifact a stage's `end` must reference, or null when unknown. */
export function discoveryStageArtifactDocType(stage: string): DiscoveryDocType | null {
  return isKnownDiscoveryStage(stage) ? STAGE_ARTIFACT[stage] : null;
}
