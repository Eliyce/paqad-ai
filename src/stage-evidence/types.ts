// Stage-evidence ledger types (issue #247).
//
// A script-written, per-code-change record proving each mandatory feature-
// development stage actually ran, IN ORDER, with a start and end datetime per
// stage, plus an end-of-change completeness gate. The honest guarantee: this
// proves a recorder script ran for a named stage at a wall-clock time over a real
// on-disk artifact — never that the stage was done well. Built on the shared
// session-ledger substrate (`src/session-ledger/`), one file per code change at
// `.paqad/ledger/<doc_type>/<session_id>/<ordinal>.jsonl`. Always-on, independent
// of any enterprise / AI-BOM flag (C1).

/** Doc type stamped on every row and used as the ledger sub-directory. */
export const STAGE_EVIDENCE_DOC_TYPE = 'paqad.stage-evidence';

/** Schema version for `paqad.stage-evidence` rows. */
export const STAGE_EVIDENCE_SCHEMA_VERSION = 1;

/** The kinds of event row a change record can carry. */
export type StageEvidenceKind = 'open' | 'stage_start' | 'stage_end' | 'verify' | 'close';

/** How a stage event resolved. */
export type StageEventStatus =
  'started' | 'completed' | 'skipped' | 'failed' | 'redone' | 'inferred';

/** Where a stage's evidence came from (honest grading — never dressed up). */
export type StageEvidenceSource =
  'live-mark' | 'inferred-artifact' | 'inferred-git' | 'redo' | null;

export type StageLane = 'fast' | 'graduated' | 'full' | null;

/** One `paqad.stage-evidence` row (envelope fields are stamped by the substrate). */
export interface StageEvidenceRow {
  schema_version: number;
  doc_type: typeof STAGE_EVIDENCE_DOC_TYPE;
  kind: StageEvidenceKind;
  session_id: string;
  /** 1-based Nth code change this session (the substrate's ordinal). */
  conversation_ordinal: number;
  ts: string;
  adapter: string;

  /** The ordered stage id this event concerns (absent on open/close). */
  stage?: string | null;
  event_status?: StageEventStatus | null;
  evidence_source?: StageEvidenceSource;
  /** Artifacts the stage produced (project-relative). */
  artifact_paths?: string[] | null;
  /** SHA-256 over the artifact bytes; null = not run / no artifact. */
  artifact_digest?: string | null;
  /** Git working-tree delta digest; set on development. */
  subject_digest?: string | null;
  lane?: StageLane;
  note?: string | null;
  content_hash: string;
}

/** The completeness verdict the verify gate computes for a change. */
export type StageCompletenessVerdict =
  'complete' | 'incomplete' | 'recovered' | 'blocked' | 'cannot-verify';

/** The folded state of a single stage within a change. */
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
  /** True when the start/end gap is implausibly small or the clock skewed. */
  duration_unreliable: boolean;
  evidence_source: StageEvidenceSource;
  artifact_digest: string | null;
}

export interface OrderingViolation {
  /** The earlier stage in canonical order. */
  before: string;
  /** The later stage that started before `before` ended. */
  after: string;
}

export interface StageCompleteness {
  verdict: StageCompletenessVerdict;
  missing_stages: string[];
  required_passed: number;
  required_total: number;
  ordering_violations: OrderingViolation[];
}

/** The per-change view `status`/`verify` compute over the event rows. */
export interface FoldedChange {
  session_id: string;
  change_key: string;
  prompt_ordinal: number;
  stages: FoldedStage[];
  completeness: StageCompleteness;
}
