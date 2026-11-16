import { GATE_CATALOG } from '@/core/types/verification.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import {
  featureBranch,
  isBundleClosed,
  isBundleMaterialized,
  sessionReattachableFeature,
} from '@/feature-evidence/adoption.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import { isFeatureFinished, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { episodeStart, readRouteTurns } from '@/pipeline/route-turns.js';
import { sessionWroteInEpisode } from '@/pipeline/session-ownership.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { readHeadRef } from '@/rag/git-state.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { hasOpenUnendedStage, liveStageAgents } from '@/stage-evidence/completion-deferred.js';

export const HUD_SCOPE_REASONS = [
  'qualified',
  'finished',
  'no-active-change',
  'no-change-yet',
  'closed',
  'other-branch',
  'not-feature-route',
  'no-row-this-episode',
] as const;

export type HudScopeReason = (typeof HUD_SCOPE_REASONS)[number];

export interface HudChangeScope {
  dir: string | null;
  reason: HudScopeReason;
  /** The branch the change was opened on, for the other-branch row. */
  branch?: string | null;
}

export const GATE_JUDGED_AFTER: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(GATE_CATALOG).map(([code, entry]) => [code, entry.stage]),
);

const UNKNOWN_GATE_STAGE = 'checks';

const EDIT_STAGES: ReadonlySet<string> = new Set(['development', 'documentation_sync']);

const STAGE_ROW_KINDS: ReadonlySet<string> = new Set(['stage_start', 'stage_end']);

const COMPLETE_END_STATUSES: ReadonlySet<string> = new Set(['completed', 'inferred']);

export function qualifyHudChange(
  projectRoot: string,
  sessionId: string,
  now: () => Date = () => new Date(),
): HudChangeScope {
  const workflow = readWorkflowState(projectRoot, sessionId);
  if (workflow.active?.workflow !== 'feature-development') {
    return { dir: null, reason: 'not-feature-route' };
  }
  const dir = currentFeature(projectRoot, sessionId, now);
  if (!dir || !isBundleMaterialized(projectRoot, dir)) {
    return finishedChange(projectRoot, sessionId, workflow.turn_started_at ?? null);
  }
  const status = readFeatureRecord(projectRoot, dir)?.status;
  if (isBundleClosed(projectRoot, dir) || isFeatureFinished(status)) {
    return { dir: null, reason: 'closed' };
  }
  const head = readHeadRef(projectRoot);
  const recorded = featureBranch(projectRoot, dir);
  if (head.detached || (recorded !== null && recorded !== head.branch)) {
    return { dir: null, reason: 'other-branch', branch: recorded };
  }
  const start =
    episodeStart(readRouteTurns(projectRoot, sessionId), 'feature-development') ??
    workflow.turn_started_at ??
    null;
  if (
    !sessionWroteInEpisode(projectRoot, sessionId, dir, start) &&
    !stageStillRunning(projectRoot, dir)
  ) {
    // A change this session adopted and never wrote a row in is not "hidden this episode": it
    // reads as Getting ready, so a new feature turn never draws nothing (B5 adoption effect).
    if (!sessionWroteInEpisode(projectRoot, sessionId, dir, null)) {
      return { dir: null, reason: 'no-change-yet' };
    }
    // A change this session worked on in an earlier feature episode and resumed now draws its
    // full band with the stage strip before any new row is written (D2 band-on-resume).
    if (resumedFeatureEpisode(projectRoot, sessionId, start)) return { dir, reason: 'qualified' };
    return { dir: null, reason: 'no-row-this-episode' };
  }
  return { dir, reason: 'qualified' };
}

function resumedFeatureEpisode(
  projectRoot: string,
  sessionId: string,
  start: string | null,
): boolean {
  if (start === null) return false;
  const startMs = Date.parse(start);
  return readRouteTurns(projectRoot, sessionId).some(
    (turn) => turn.workflow === 'feature-development' && Date.parse(turn.at) < startMs,
  );
}

function stageStillRunning(projectRoot: string, dirName: string): boolean {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  return hasOpenUnendedStage(rows) || liveStageAgents(rows).length > 0;
}

function finishedChange(
  projectRoot: string,
  sessionId: string,
  turnStartedAt: string | null,
): HudChangeScope {
  const none: HudChangeScope = { dir: null, reason: 'no-active-change' };
  const head = readHeadRef(projectRoot);
  if (head.detached) return none;
  const dir = sessionReattachableFeature(projectRoot, sessionId, head.branch);
  if (dir && !closedBeforeTurn(projectRoot, dir, turnStartedAt)) {
    const start =
      episodeStart(readRouteTurns(projectRoot, sessionId), 'feature-development') ?? turnStartedAt;
    if (
      sessionWroteInEpisode(projectRoot, sessionId, dir, start) ||
      stageStillRunning(projectRoot, dir)
    ) {
      return { dir, reason: 'finished' };
    }
  }
  return noChangeYet(projectRoot, sessionId, turnStartedAt)
    ? { dir: null, reason: 'no-change-yet' }
    : none;
}

/** A change closed before this turn started is the last turn's news: a new feature turn draws
 *  Getting ready for the next change, not the closed one (AC-27). */
function closedBeforeTurn(projectRoot: string, dir: string, turnStartedAt: string | null): boolean {
  const turnMs = turnStartedAt === null ? NaN : Date.parse(turnStartedAt);
  if (Number.isNaN(turnMs)) return false;
  let closedMs = NaN;
  for (const row of readFeatureStageUnit(projectRoot, dir)) {
    if (row.kind === 'open') closedMs = NaN;
    if (row.kind === 'close') closedMs = rowTime(row);
  }
  return !Number.isNaN(closedMs) && closedMs < turnMs;
}

function noChangeYet(
  projectRoot: string,
  sessionId: string,
  turnStartedAt: string | null,
): boolean {
  if (turnStartedAt === null || Number.isNaN(Date.parse(turnStartedAt))) return false;
  return !listFeatureDirs(projectRoot).some((dir) =>
    sessionWroteInEpisode(projectRoot, sessionId, dir, turnStartedAt),
  );
}

function rowTime(row: SessionLedgerRow): number {
  return Date.parse(rowRecordedAt(row) ?? '');
}

function carriesEdit(row: SessionLedgerRow): boolean {
  if (!STAGE_ROW_KINDS.has(String(row.kind)) || typeof row.stage !== 'string') return false;
  if (EDIT_STAGES.has(row.stage)) return true;
  return row.stage === 'specification' && typeof row.subject_digest === 'string';
}

export function latestEditAt(projectRoot: string, dirName: string): number | null {
  let latest: number | null = null;
  for (const row of readFeatureStageUnit(projectRoot, dirName)) {
    if (!carriesEdit(row)) continue;
    const at = rowTime(row);
    if (!Number.isNaN(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

const RECHECK_STAGES: ReadonlySet<string> = new Set(['checks']);

function movesRunOn(row: SessionLedgerRow): boolean {
  if (row.kind === 'completion-deferred') return true;
  return STAGE_ROW_KINDS.has(String(row.kind)) && !RECHECK_STAGES.has(String(row.stage));
}

export function latestStageMoveAt(projectRoot: string, dirName: string): number | null {
  let latest: number | null = null;
  for (const row of readFeatureStageUnit(projectRoot, dirName)) {
    if (!movesRunOn(row)) continue;
    const at = rowTime(row);
    if (!Number.isNaN(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

export function stageEndTimes(projectRoot: string, dirName: string): Map<string, number> {
  const ends = new Map<string, number>();
  for (const row of readFeatureStageUnit(projectRoot, dirName)) {
    if (row.kind !== 'stage_end' || typeof row.stage !== 'string') continue;
    if (!COMPLETE_END_STATUSES.has(String(row.event_status))) continue;
    const at = rowTime(row);
    if (!Number.isNaN(at)) ends.set(row.stage, Math.max(ends.get(row.stage) ?? at, at));
  }
  return ends;
}

export function gateIsJudged(
  code: string,
  recordedAt: string | null,
  stageEnds: ReadonlyMap<string, number>,
): boolean {
  const owner = GATE_JUDGED_AFTER[code] ?? UNKNOWN_GATE_STAGE;
  const endedAt = stageEnds.get(owner);
  if (endedAt === undefined) return false;
  const at = Date.parse(recordedAt ?? '');
  return !Number.isNaN(at) && at >= endedAt;
}
