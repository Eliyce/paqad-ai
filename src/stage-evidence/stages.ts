import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';

import { type StageLane } from './types.js';

export const STAGE_EVIDENCE_STAGES: readonly string[] = [...STAGE_ORDER];

export type StageId = (typeof STAGE_ORDER)[number];

export const MANDATORY_STAGES: readonly StageId[] = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

export const PRE_CODE_STAGES: readonly StageId[] = MANDATORY_STAGES.slice(
  0,
  MANDATORY_STAGES.indexOf('development'),
);

const FAST_LANE_STAGES: readonly StageId[] = ['planning', 'development', 'checks'];

export function laneStages(lane: StageLane): StageId[] {
  return lane === 'fast' ? [...FAST_LANE_STAGES] : [...MANDATORY_STAGES];
}

export function isLaneStage(lane: StageLane, stage: string): boolean {
  return (laneStages(lane) as readonly string[]).includes(stage);
}

export function requiredPreCodeStages(lane: StageLane): StageId[] {
  return laneStages(lane).filter((stage) => PRE_CODE_STAGES.includes(stage));
}

export const COMPLETION_ANCHORED_STAGES: readonly StageId[] = ['review'];

export const ARTIFACT_BEARING_STAGES: readonly StageId[] = ['planning', 'specification', 'review'];

export function isKnownStage(stage: string): stage is StageId {
  return (STAGE_EVIDENCE_STAGES as readonly string[]).includes(stage);
}

export function isArtifactBearingStage(stage: string): boolean {
  return (ARTIFACT_BEARING_STAGES as readonly string[]).includes(stage);
}

export function isCompletionAnchoredStage(stage: string): boolean {
  return (COMPLETION_ANCHORED_STAGES as readonly string[]).includes(stage);
}

export function isMandatoryStage(stage: string): boolean {
  return (MANDATORY_STAGES as readonly string[]).includes(stage);
}

export function stageIndex(stage: string): number {
  return STAGE_EVIDENCE_STAGES.indexOf(stage);
}
