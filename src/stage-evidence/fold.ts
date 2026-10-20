import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

import {
  isArtifactBearingStage,
  isCompletionAnchoredStage,
  isMandatoryStage,
  STAGE_EVIDENCE_STAGES,
  stageIndex,
} from './stages.js';
import {
  STAGE_FAMILY_KINDS,
  type FoldedChange,
  type FoldedStage,
  type OrderingViolation,
  type StageCompletenessVerdict,
  type StageEvidenceSource,
  type StageLane,
  type StageState,
} from './types.js';

export interface FoldIdentity {
  sessionId: string;
  changeKey: string;
  promptOrdinal: number;
}

export function foldRowsWithKey(
  rows: readonly SessionLedgerRow[],
  identity: FoldIdentity,
): FoldedChange {
  const { sessionId, changeKey: change_key, promptOrdinal: ordinal } = identity;
  const stageRows = rows.filter((row) => STAGE_FAMILY_KINDS.has(String(row.kind)));
  const stages = STAGE_EVIDENCE_STAGES.map((stage) => foldStage(stage, stageRows));
  const orderingViolations = computeOrderingViolations(stages);

  const required = stages.filter((stage) => isMandatoryStage(stage.stage));
  const isDone = (stage: FoldedStage) => stage.state === 'complete' || stage.state === 'redone';
  const passed = required.filter(isDone);
  const missing = required
    .filter((stage) => !isDone(stage) && stage.state !== 'not-applicable')
    .map((stage) => stage.stage);
  const hadRedo = stages.some((stage) => stage.state === 'redone');

  const verdict = computeVerdict(stageRows, missing, orderingViolations.length > 0, hadRedo);

  return {
    session_id: sessionId,
    change_key,
    prompt_ordinal: ordinal,
    stages,
    lane: readRecordedLane(stageRows),
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

  const startedAt = start ? rowRecordedAt(start) : null;
  const endedAt = end ? rowRecordedAt(end) : null;
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

function readRecordedLane(rows: readonly SessionLedgerRow[]): StageLane {
  const openRow = rows.find((row) => row.kind === 'open');
  const value = openRow?.lane;
  return value === 'fast' || value === 'graduated' || value === 'full' ? value : null;
}

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
    if (!start && end.evidence_source !== 'inferred-git') return 'inconclusive';
    if (isArtifactBearingStage(stage) && typeof end.artifact_digest !== 'string') {
      return 'inconclusive';
    }
    return 'complete';
  }
  if (start) return 'running';
  return 'missing';
}

function computeOrderingViolations(stages: readonly FoldedStage[]): OrderingViolation[] {
  const violations: OrderingViolation[] = [];
  const ran = stages.filter((stage) => stage.started_at);
  for (const stage of ran) {
    if (stage.duration_unreliable) {
      violations.push({ before: stage.stage, after: stage.stage });
    }
  }
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

export interface BundleArtifactPresence {
  plan: boolean;
  specification: boolean;
}

const RIGID_STAGE_FILE: ReadonlyArray<{ stage: string; key: keyof BundleArtifactPresence }> = [
  { stage: 'planning', key: 'plan' },
  { stage: 'specification', key: 'specification' },
];

export function augmentWithBundleArtifacts(
  fold: FoldedChange,
  presence: BundleArtifactPresence,
): FoldedChange {
  const missing = [...fold.completeness.missing_stages];
  for (const { stage, key } of RIGID_STAGE_FILE) {
    if (!presence[key] && !missing.includes(stage)) {
      missing.push(stage);
    }
  }
  if (missing.length === fold.completeness.missing_stages.length) {
    return fold;
  }
  const verdict: StageCompletenessVerdict =
    fold.completeness.verdict === 'complete' || fold.completeness.verdict === 'recovered'
      ? 'incomplete'
      : fold.completeness.verdict;
  return {
    ...fold,
    completeness: { ...fold.completeness, verdict, missing_stages: missing },
  };
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
