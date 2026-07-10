// Fold stage-evidence event rows into the per-change view (issue #247 §4).
//
// Pure function over the rows of one (session, change-ordinal): computes each
// stage's state, start/end datetimes, derived `duration_ms`, ordering violations,
// and the completeness verdict the `verify` gate acts on. All timing is wall-clock
// (the script clock that stamped each `ts`); a negative/zero gap is clamped and
// flagged `unreliable` rather than trusted.

import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

import {
  isArtifactBearingStage,
  isCompletionAnchoredStage,
  isMandatoryStage,
  STAGE_EVIDENCE_STAGES,
  stageIndex,
} from './stages.js';
import {
  type FoldedChange,
  type FoldedStage,
  type OrderingViolation,
  type StageCompletenessVerdict,
  type StageEvidenceSource,
  type StageLane,
  type StageState,
} from './types.js';

/** Identity a fold is keyed under — the per-feature dir name (issue #339). */
export interface FoldIdentity {
  sessionId: string;
  changeKey: string;
  promptOrdinal: number;
}

/**
 * Fold an in-memory set of rows into the per-change view (the testable core). The
 * change identity is supplied by the caller (the feature dir name is the change key,
 * issue #339); the reader that fetches a feature's rows and calls this is `foldFeature`
 * in `feature-evidence/stage-ledger.ts`.
 */
export function foldRowsWithKey(
  rows: readonly SessionLedgerRow[],
  identity: FoldIdentity,
): FoldedChange {
  const { sessionId, changeKey: change_key, promptOrdinal: ordinal } = identity;
  const stages = STAGE_EVIDENCE_STAGES.map((stage) => foldStage(stage, rows));
  const orderingViolations = computeOrderingViolations(stages);

  const required = stages.filter((stage) => isMandatoryStage(stage.stage));
  // A `redone` stage that reached an end counts as done — it was re-run to
  // completion. The redo itself is tracked separately (hadRedo → `recovered`).
  const isDone = (stage: FoldedStage) => stage.state === 'complete' || stage.state === 'redone';
  const passed = required.filter(isDone);
  const missing = required
    .filter((stage) => !isDone(stage) && stage.state !== 'not-applicable')
    .map((stage) => stage.stage);
  const hadRedo = stages.some((stage) => stage.state === 'redone');

  const verdict = computeVerdict(rows, missing, orderingViolations.length > 0, hadRedo);

  return {
    session_id: sessionId,
    change_key,
    prompt_ordinal: ordinal,
    stages,
    lane: readRecordedLane(rows),
    completeness: {
      verdict,
      missing_stages: missing,
      required_passed: passed.length,
      required_total: required.length,
      ordering_violations: orderingViolations,
    },
  };
}

function foldStage(stage: string, rows: readonly SessionLedgerRow[]): FoldedStage {
  const events = rows.filter((row) => row.stage === stage);
  const start = lastOf(events, 'stage_start');
  const end = lastOf(events, 'stage_end');

  const startedAt = start ? start.ts : null;
  const endedAt = end ? end.ts : null;
  let durationMs: number | null = null;
  let unreliable = false;
  if (startedAt && endedAt) {
    durationMs = Date.parse(endedAt) - Date.parse(startedAt);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      durationMs = 0;
      unreliable = true;
    }
  }

  return {
    stage,
    state: deriveState(stage, events, start, end),
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    duration_unreliable: unreliable,
    evidence_source: coerceEvidenceSource((end ?? start)?.evidence_source),
    artifact_digest: typeof end?.artifact_digest === 'string' ? end.artifact_digest : null,
  };
}

/**
 * The recorded lane for the change (issue #324): the `lane` stamped on the open row.
 * The open row is authoritative — it is written once with the lane the prompt seam
 * picked. An absent open row, or an unrecognised value, folds to null (consumers fail
 * safe to `full`).
 */
function readRecordedLane(rows: readonly SessionLedgerRow[]): StageLane {
  const openRow = rows.find((row) => row.kind === 'open');
  const value = openRow?.lane;
  return value === 'fast' || value === 'graduated' || value === 'full' ? value : null;
}

/** Narrow the substrate's `unknown` evidence_source field to the typed union. */
function coerceEvidenceSource(value: unknown): StageEvidenceSource {
  return value === 'live-mark' ||
    value === 'inferred-artifact' ||
    value === 'inferred-git' ||
    value === 'redo'
    ? value
    : null;
}

function deriveState(
  stage: string,
  events: readonly SessionLedgerRow[],
  start: SessionLedgerRow | undefined,
  end: SessionLedgerRow | undefined,
): StageState {
  const status = (end ?? start)?.event_status;
  if (status === 'skipped') return 'skipped';
  if (status === 'failed') return 'failed';
  if (events.some((event) => event.event_status === 'redone')) return 'redone';
  if (end) {
    // An end with no matching start is an orphan — the #310 signature (the old
    // recorder rejected the out-of-order start but accepted any end, so a stage could
    // carry an end alone). It is inconclusive, never silently `complete`, so the
    // completion fold and the pre-mutation gate (which requires a start+end pair)
    // agree a stage needs a start. The inferred-git backstop is exempt: it
    // deliberately writes an end-only `development` row to represent an untracked diff.
    if (!start && end.evidence_source !== 'inferred-git') return 'inconclusive';
    // Artifact honesty (issue #320): a thinking stage (planning/specification/review)
    // whose end carries no real artifact digest proves no work happened — two adjacent
    // marker lines satisfy the pair but hash nothing. It is inconclusive, never
    // silently `complete`. Mutation stages are exempt: the observed edit is their proof.
    if (isArtifactBearingStage(stage) && typeof end.artifact_digest !== 'string') {
      return 'inconclusive';
    }
    return 'complete';
  }
  if (start) return 'running';
  return 'missing';
}

/**
 * For each ordered pair A before B that both ran, flag when B started before A ended.
 *
 * A completion-anchored stage (`review`, issue #270) participates in no ordering
 * constraint: its canonical position is the completion boundary, so it legitimately
 * ends after later-indexed stages (`checks`, `documentation_sync`) have started. A
 * pair with such a stage on either side is skipped, never a violation. This forgives
 * a late review's ordering only — completeness (was review recorded at all?) is
 * decided separately, so an unmarked review is still missing.
 */
function computeOrderingViolations(stages: readonly FoldedStage[]): OrderingViolation[] {
  const violations: OrderingViolation[] = [];
  const ran = stages.filter((stage) => stage.started_at);
  for (const a of ran) {
    for (const b of ran) {
      if (isCompletionAnchoredStage(a.stage) || isCompletionAnchoredStage(b.stage)) {
        continue;
      }
      if (stageIndex(a.stage) < stageIndex(b.stage) && a.ended_at && b.started_at) {
        if (Date.parse(b.started_at) < Date.parse(a.ended_at)) {
          violations.push({ before: a.stage, after: b.stage });
        }
      }
    }
  }
  return violations;
}

function computeVerdict(
  rows: readonly SessionLedgerRow[],
  missing: readonly string[],
  hasOrderingViolation: boolean,
  hadRedo: boolean,
): StageCompletenessVerdict {
  if (rows.length === 0) {
    return 'cannot-verify';
  }
  if (missing.length > 0) {
    return 'incomplete';
  }
  if (hasOrderingViolation) {
    return 'incomplete';
  }
  return hadRedo ? 'recovered' : 'complete';
}

function lastOf(events: readonly SessionLedgerRow[], kind: string): SessionLedgerRow | undefined {
  let found: SessionLedgerRow | undefined;
  for (const event of events) {
    if (event.kind === kind) {
      found = event;
    }
  }
  return found;
}
