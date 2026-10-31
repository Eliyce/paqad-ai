import {
  isBundleClosed,
  isBundleMaterialized,
  listInFlightFeatures,
} from '@/feature-evidence/adoption.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { isStageAgent } from '@/stage-evidence/agent-identity.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

import { isFeatureDevelopmentRoute, type RoutedWorkflow } from './routed-workflow.js';
import { readWorkflowState, type WorkflowState } from './workflow-state.js';

export type CompletionSkipReason = 'not-owner' | 'detour';

export type CompletionEnforceReason =
  'edited-this-turn' | 'owner-feature-dev' | 'owner-unknown-route';

export type CompletionEnforcement = (
  | { enforce: false; reason: CompletionSkipReason }
  | { enforce: true; reason: CompletionEnforceReason }
) & {
  activeWorkflow: RoutedWorkflow | null;
};

const AGENT_AUTHORED_SOURCES = new Set(['live-mark', 'redo']);

export function sessionOwnedRows(projectRoot: string, sessionId: string): SessionLedgerRow[] {
  let dirNames: string[];
  try {
    dirNames = listInFlightFeatures(projectRoot);
  } catch {
    return [];
  }
  const ownBundle = readSessionControl(projectRoot, sessionId).active;
  if (ownBundle !== null && !dirNames.includes(ownBundle) && isReopened(projectRoot, ownBundle)) {
    dirNames = [...dirNames, ownBundle];
  }
  const lastPrompt = lastPromptAt(projectRoot, sessionId);
  return dirNames.flatMap((dirName) =>
    readFeatureStageUnit(projectRoot, dirName).filter(
      (row) =>
        (row.session_id === sessionId &&
          typeof row.evidence_source === 'string' &&
          AGENT_AUTHORED_SOURCES.has(row.evidence_source)) ||
        (dirName === ownBundle &&
          isStageAgentRow(row) &&
          stageAgentRowIsOwn(row, sessionId, lastPrompt)),
    ),
  );
}

function isReopened(projectRoot: string, dirName: string): boolean {
  return isBundleMaterialized(projectRoot, dirName) && !isBundleClosed(projectRoot, dirName);
}

export function sessionWroteInEpisode(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  episodeStartAt: string | null,
): boolean {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const since = episodeStartAt === null ? NaN : Date.parse(episodeStartAt);
  const wroteSince = rows.some((row) => {
    if (row.session_id !== sessionId) return false;
    if (Number.isNaN(since)) return true;
    const at = Date.parse(rowRecordedAt(row) ?? '');
    return !Number.isNaN(at) && at >= since;
  });
  return (
    wroteSince || rows.some((row, index) => isOwnRunningStageStart(rows, row, index, sessionId))
  );
}

function isOwnRunningStageStart(
  rows: readonly SessionLedgerRow[],
  row: SessionLedgerRow,
  index: number,
  sessionId: string,
): boolean {
  if (row.kind !== 'stage_start' || row.session_id !== sessionId) return false;
  return !rows
    .slice(index + 1)
    .some((later) => later.kind === 'stage_end' && later.stage === row.stage);
}

function lastPromptAt(projectRoot: string, sessionId: string): number {
  const stamp = readWorkflowState(projectRoot, sessionId).turn_started_at;
  return stamp === undefined ? NaN : Date.parse(stamp);
}

function stageAgentRowIsOwn(row: SessionLedgerRow, sessionId: string, lastPrompt: number): boolean {
  if (Number.isNaN(lastPrompt)) {
    return true;
  }
  if (row.session_id !== sessionId) {
    return false;
  }
  const at = Date.parse(rowRecordedAt(row) ?? '');
  return !Number.isNaN(at) && at >= lastPrompt;
}

function isStageAgentRow(row: SessionLedgerRow): boolean {
  return row.kind === STAGE_AGENT_KIND || isStageAgent(row.agent as string | undefined);
}

function editedThisTurn(owned: readonly SessionLedgerRow[], state: WorkflowState): boolean {
  const turnStart = state.turn_started_at === undefined ? NaN : Date.parse(state.turn_started_at);
  if (Number.isNaN(turnStart)) {
    return owned.length > 0;
  }
  return owned.some((row) => {
    if (row.session_source === 'cache') {
      return false;
    }
    const at = Date.parse(rowRecordedAt(row) ?? '');
    return !Number.isNaN(at) && at >= turnStart;
  });
}

export function editedDevelopmentThisTurn(projectRoot: string, sessionId: string): boolean {
  const development = sessionOwnedRows(projectRoot, sessionId).filter(
    (row) => row.stage === 'development',
  );
  if (development.length === 0) {
    return false;
  }
  return editedThisTurn(development, readWorkflowState(projectRoot, sessionId));
}

export function classifyCompletionEnforcement(
  projectRoot: string,
  sessionId?: string | null,
): CompletionEnforcement {
  let resolved: string;
  try {
    resolved = resolveSessionId(projectRoot, sessionId ?? null);
    /* v8 ignore start -- resolveSessionId swallows its own fs errors; kept so any future
       throw reads as "owns nothing" instead of crashing the completion seam. */
  } catch {
    return { enforce: false, reason: 'not-owner', activeWorkflow: null };
    /* v8 ignore stop */
  }
  const state = readWorkflowState(projectRoot, resolved);
  const activeWorkflow = state.active?.workflow ?? null;
  const owned = sessionOwnedRows(projectRoot, resolved);

  if (owned.length === 0) {
    return { enforce: false, reason: 'not-owner', activeWorkflow };
  }
  if (editedThisTurn(owned, state)) {
    return { enforce: true, reason: 'edited-this-turn', activeWorkflow };
  }
  if (activeWorkflow === null) {
    return { enforce: true, reason: 'owner-unknown-route', activeWorkflow };
  }
  if (isFeatureDevelopmentRoute(activeWorkflow)) {
    return { enforce: true, reason: 'owner-feature-dev', activeWorkflow };
  }
  return { enforce: false, reason: 'detour', activeWorkflow };
}
