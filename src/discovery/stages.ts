import type { DiscoveryRunFile } from './paths.js';
import type { DiscoveryDocType } from './types.js';
import { DISCOVERY_DOC_TYPES } from './types.js';

export const DISCOVERY_STAGE_ORDER = [
  'understand',
  'investigate',
  'refine',
  'decide',
  'check_readiness',
  'hand_off',
] as const;

export type DiscoveryStageId = (typeof DISCOVERY_STAGE_ORDER)[number];

export const MANDATORY_DISCOVERY_STAGES: readonly DiscoveryStageId[] = [...DISCOVERY_STAGE_ORDER];

const STAGE_ARTIFACT: Readonly<Record<DiscoveryStageId, DiscoveryDocType>> = {
  understand: DISCOVERY_DOC_TYPES.brief,
  investigate: DISCOVERY_DOC_TYPES.source,
  refine: DISCOVERY_DOC_TYPES.synthesis,
  decide: DISCOVERY_DOC_TYPES.decisions,
  check_readiness: DISCOVERY_DOC_TYPES.readiness,
  hand_off: DISCOVERY_DOC_TYPES.handoff,
} as const;

export function isKnownDiscoveryStage(stage: string): stage is DiscoveryStageId {
  return (DISCOVERY_STAGE_ORDER as readonly string[]).includes(stage);
}

export function isMandatoryDiscoveryStage(stage: string): stage is DiscoveryStageId {
  return (MANDATORY_DISCOVERY_STAGES as readonly string[]).includes(stage);
}

export function discoveryStageIndex(stage: string): number {
  return (DISCOVERY_STAGE_ORDER as readonly string[]).indexOf(stage);
}

export function discoveryStageArtifactDocType(stage: string): DiscoveryDocType | null {
  return isKnownDiscoveryStage(stage) ? STAGE_ARTIFACT[stage] : null;
}

const STAGE_ARTIFACT_FILE: Readonly<Record<DiscoveryStageId, DiscoveryRunFile>> = {
  understand: 'brief',
  investigate: 'sources',
  refine: 'synthesis',
  decide: 'decisions',
  check_readiness: 'readiness',
  hand_off: 'handoff',
} as const;

export function discoveryStageArtifactFile(stage: string): DiscoveryRunFile | null {
  return isKnownDiscoveryStage(stage) ? STAGE_ARTIFACT_FILE[stage] : null;
}
