export const STAGE_EVIDENCE_DOC_TYPE = 'paqad.stage-evidence';

export const STAGE_EVIDENCE_SCHEMA_VERSION = 2;

export type StageEvidenceKind =
  | 'open'
  | 'stage_start'
  | 'stage_end'
  | 'verify'
  | 'close'
  | 'stage-agent'
  | 'spec-step'
  | 'spec-correction'
  | 'completion-deferred';

export const STAGE_AGENT_KIND = 'stage-agent';

export const SPEC_STEP_KIND = 'spec-step';

export const SPEC_CORRECTION_KIND = 'spec-correction';

export const COMPLETION_DEFERRED_KIND = 'completion-deferred';

export const SPEC_STEP_OUTCOMES = ['complete', 'skipped', 'redone'] as const;
export type SpecStepOutcome = (typeof SPEC_STEP_OUTCOMES)[number];

export const STAGE_FAMILY_KIND_LIST = [
  'open',
  'stage_start',
  'stage_end',
  'verify',
  'close',
] as const;
export const STAGE_FAMILY_KINDS: ReadonlySet<string> = new Set(STAGE_FAMILY_KIND_LIST);

export type StageEventStatus =
  'started' | 'completed' | 'skipped' | 'failed' | 'redone' | 'inferred';

export type StageEvidenceSource =
  'live-mark' | 'inferred-artifact' | 'inferred-git' | 'redo' | null;

export type StageLane = 'fast' | 'graduated' | 'full' | null;

export type StageSessionSource = 'host' | 'env' | 'cache' | null;

export interface StageEvidenceRow {
  schema_version: number;
  doc_type: typeof STAGE_EVIDENCE_DOC_TYPE;
  kind: StageEvidenceKind;
  session_id: string;
  conversation_ordinal: number;
  ts: string;
  adapter?: string;

  stage?: string | null;
  event_status?: StageEventStatus | null;
  evidence_source?: StageEvidenceSource;
  artifact_paths?: string[] | null;
  artifact_digest?: string | null;
  subject_digest?: string | null;
  lane?: StageLane;
  session_source?: StageSessionSource;
  note?: string | null;
  content_hash: string;
}

export type StageCompletenessVerdict =
  'complete' | 'incomplete' | 'recovered' | 'blocked' | 'cannot-verify';

export type StageState =
  | 'complete'
  | 'running'
  | 'missing'
  | 'skipped'
  | 'failed'
  | 'redone'
  | 'not-applicable'
  | 'inconclusive';

export interface FoldedStage {
  stage: string;
  state: StageState;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  duration_unreliable: boolean;
  evidence_source: StageEvidenceSource;
  artifact_digest: string | null;
}

export interface OrderingViolation {
  before: string;
  after: string;
}

export interface StageCompleteness {
  verdict: StageCompletenessVerdict;
  missing_stages: string[];
  required_passed: number;
  required_total: number;
  ordering_violations: OrderingViolation[];
}

export interface FoldedChange {
  session_id: string;
  change_key: string;
  prompt_ordinal: number;
  stages: FoldedStage[];
  completeness: StageCompleteness;
  lane: StageLane;
}
