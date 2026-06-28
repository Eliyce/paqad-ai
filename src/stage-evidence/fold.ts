// Fold stage-evidence event rows into the per-change view (issue #247 §4).
//
// Pure function over the rows of one (session, change-ordinal): computes each
// stage's state, start/end datetimes, derived `duration_ms`, ordering violations,
// and the completeness verdict the `verify` gate acts on. All timing is wall-clock
// (the script clock that stamped each `ts`); a negative/zero gap is clamped and
// flagged `unreliable` rather than trusted.

import { readSessionUnit, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { changeKey } from './recorder.js';
import { isMandatoryStage, STAGE_EVIDENCE_STAGES, stageIndex } from './stages.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  type FoldedChange,
  type FoldedStage,
  type OrderingViolation,
  type StageCompletenessVerdict,
  type StageEvidenceSource,
  type StageState,
} from './types.js';

/** Read and fold one change's rows into the per-change view. */
export function foldChange(projectRoot: string, sessionId: string, ordinal: number): FoldedChange {
  const rows = readSessionUnit(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId, ordinal);
  return foldRows(rows, sessionId, ordinal);
}

/** Fold an in-memory set of rows (the testable core). */
export function foldRows(
  rows: readonly SessionLedgerRow[],
  sessionId: string,
  ordinal: number,
): FoldedChange {
  const stages = STAGE_EVIDENCE_STAGES.map((stage) => foldStage(stage, rows));
  const orderingViolations = computeOrderingViolations(stages);

  const required = stages.filter((stage) => isMandatoryStage(stage.stage));
  const passed = required.filter((stage) => stage.state === 'complete');
  const missing = required
    .filter((stage) => stage.state !== 'complete' && stage.state !== 'not-applicable')
    .map((stage) => stage.stage);
  const hadRedo = stages.some((stage) => stage.state === 'redone');

  const verdict = computeVerdict(rows, missing, orderingViolations.length > 0, hadRedo);

  return {
    session_id: sessionId,
    change_key: changeKey(sessionId, ordinal),
    prompt_ordinal: ordinal,
    stages,
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
    state: deriveState(events, start, end),
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    duration_unreliable: unreliable,
    evidence_source: coerceEvidenceSource((end ?? start)?.evidence_source),
    artifact_digest: typeof end?.artifact_digest === 'string' ? end.artifact_digest : null,
  };
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
  events: readonly SessionLedgerRow[],
  start: SessionLedgerRow | undefined,
  end: SessionLedgerRow | undefined,
): StageState {
  const status = (end ?? start)?.event_status;
  if (status === 'skipped') return 'skipped';
  if (status === 'failed') return 'failed';
  if (events.some((event) => event.event_status === 'redone')) return 'redone';
  if (end) return 'complete';
  if (start) return 'running';
  return 'missing';
}

/** For each ordered pair A before B that both ran, flag when B started before A ended. */
function computeOrderingViolations(stages: readonly FoldedStage[]): OrderingViolation[] {
  const violations: OrderingViolation[] = [];
  const ran = stages.filter((stage) => stage.started_at);
  for (const a of ran) {
    for (const b of ran) {
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
