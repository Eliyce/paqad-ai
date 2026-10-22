export {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type StageEvidenceRow,
  type StageEvidenceKind,
  type FoldedChange,
  type FoldedStage,
  type StageCompleteness,
  type StageCompletenessVerdict,
  type OrderingViolation,
  type StageLane,
} from './types.js';
export { readPendingLane, writePendingLane } from './pending-lane.js';
export {
  STAGE_EVIDENCE_STAGES,
  MANDATORY_STAGES,
  COMPLETION_ANCHORED_STAGES,
  ARTIFACT_BEARING_STAGES,
  isKnownStage,
  isMandatoryStage,
  EDIT_STAGES,
  isEditStage,
  isLaneStage,
  laneStages,
  isCompletionAnchoredStage,
  isArtifactBearingStage,
  stageIndex,
  type StageId,
} from './stages.js';
export { validateStageEvidenceRow, STAGE_EVIDENCE_SCHEMA } from './schema.js';
export {
  openStageEvidence,
  startStage,
  endStage,
  type StageEvidenceContext,
  type EndStageInput,
} from './recorder.js';
export {
  foldRowsWithKey,
  augmentWithBundleArtifacts,
  type FoldIdentity,
  type BundleArtifactPresence,
} from './fold.js';
export { verifyChange, REDO_CAP, type VerifyResult, type VerifyContext } from './verify.js';
export {
  closeVerifiedChange,
  finalizeStageEvidence,
  type CloseVerifiedChangeInput,
  type FinalizeStageEvidenceInput,
} from './finalize.js';
