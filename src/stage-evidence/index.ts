// Stage-evidence ledger (issue #247) — public surface.
//
// A script-written, per-code-change record proving each mandatory feature-
// development stage ran, in order, with per-stage start/end datetimes, plus an
// end-of-change completeness gate. Built on the shared session-ledger substrate;
// always-on and independent of any enterprise / AI-BOM flag.

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
  changeKey,
  type StageEvidenceContext,
  type EndStageInput,
} from './recorder.js';
export { foldChange, foldRows } from './fold.js';
export { verifyChange, REDO_CAP, type VerifyResult, type VerifyContext } from './verify.js';
export { finalizeStageEvidence, type FinalizeStageEvidenceInput } from './finalize.js';
