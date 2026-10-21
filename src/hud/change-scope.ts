import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import {
  featureBranch,
  isBundleClosed,
  isBundleMaterialized,
} from '@/feature-evidence/adoption.js';
import { isFeatureFinished, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { episodeStart, readRouteTurns } from '@/pipeline/route-turns.js';
import { sessionWroteInEpisode } from '@/pipeline/session-ownership.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { readHeadRef } from '@/rag/git-state.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

export type HudScopeReason =
  | 'qualified'
  | 'no-active-change'
  | 'closed'
  | 'other-branch'
  | 'not-feature-route'
  | 'no-row-this-episode';

export interface HudChangeScope {
  dir: string | null;
  reason: HudScopeReason;
}

export const GATE_JUDGED_AFTER: Readonly<Record<string, string>> = {
  'spec-review': 'specification',
  'requirement-completeness': 'specification',
  'story-quality': 'specification',
  'change-completeness': 'development',
  'architecture-compliance': 'development',
  'database-quality': 'development',
  duplication: 'development',
  'extension-surface': 'development',
  'fix-proof': 'development',
  'implementation-review': 'review',
  'code-tests-lint': 'checks',
  'behavioral-correctness': 'checks',
  'mutation-testing': 'checks',
  'quality-ratchet': 'checks',
  'ac-test-mapping': 'checks',
  'documentation-freshness': 'documentation_sync',
  'module-docs-structure': 'documentation_sync',
  'instructions-docs-structure': 'documentation_sync',
  'site-map-freshness': 'documentation_sync',
};

const UNKNOWN_GATE_STAGE = 'checks';

const EDIT_STAGES: ReadonlySet<string> = new Set(['development', 'checks', 'documentation_sync']);

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
    return { dir: null, reason: 'no-active-change' };
  }
  const status = readFeatureRecord(projectRoot, dir)?.status;
  if (isBundleClosed(projectRoot, dir) || isFeatureFinished(status)) {
    return { dir: null, reason: 'closed' };
  }
  const head = readHeadRef(projectRoot);
  const recorded = featureBranch(projectRoot, dir);
  if (head.detached || (recorded !== null && recorded !== head.branch)) {
    return { dir: null, reason: 'other-branch' };
  }
  const start =
    episodeStart(readRouteTurns(projectRoot, sessionId), 'feature-development') ??
    workflow.turn_started_at ??
    null;
  if (!sessionWroteInEpisode(projectRoot, sessionId, dir, start)) {
    return { dir: null, reason: 'no-row-this-episode' };
  }
  return { dir, reason: 'qualified' };
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
