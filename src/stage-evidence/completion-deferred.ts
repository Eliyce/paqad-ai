import {
  CHECKS_RUNNING_CEILING_MS,
  liveChecksRunningMarker,
  type ChecksMarkerProbe,
} from '@/checks/running-marker.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { stageIsOpen, stagesWithKind } from './live-writer.js';
import { COMPLETION_DEFERRED_KIND } from './types.js';

const AGENT_TYPE_FIELDS = [
  'agent_type',
  'agentType',
  'subagent_type',
  'subagentType',
  'type',
] as const;

function agentTypeOf(task: unknown): string | undefined {
  if (!task || typeof task !== 'object') {
    return undefined;
  }
  for (const field of AGENT_TYPE_FIELDS) {
    const value = (task as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

export function stageAgentTaskCount(tasks: readonly unknown[]): number {
  return tasks.filter((task) => agentTypeOf(task)?.startsWith('paqad-')).length;
}

export function hasOpenUnendedStage(rows: readonly SessionLedgerRow[]): boolean {
  for (const stage of stagesWithKind(rows, 'stage_start')) {
    if (stageIsOpen(rows, stage)) {
      return true;
    }
  }
  return false;
}

export interface DeferCompletionInput {
  projectRoot: string;
  backgroundTasks: unknown;
  sessionId?: string | null;
  adapter: string;
  now?: () => Date;
  probe?: ChecksMarkerProbe;
}

export interface DeferCompletionResult {
  deferred: boolean;
  reason?: string;
  tasks?: number;
}

export function deferCompletionForBackgroundStage(
  input: DeferCompletionInput,
): DeferCompletionResult {
  const tasks = Array.isArray(input.backgroundTasks) ? input.backgroundTasks : [];
  const now = input.now ?? (() => new Date());
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId ?? null);
  const checksRunning =
    liveChecksRunningMarker(input.projectRoot, sessionId, { ...input.probe, now }) !== null;
  if (tasks.length === 0 && !checksRunning) {
    return { deferred: false };
  }
  const dirName = currentFeature(input.projectRoot, sessionId);
  const rows = dirName !== null ? readFeatureStageUnit(input.projectRoot, dirName) : [];

  let reason: string;
  let count: number;
  const stageAgents = stageAgentTaskCount(tasks);
  if (checksRunning) {
    reason = 'checks run still running';
    count = tasks.length;
  } else if (stageAgents > 0) {
    reason = 'stage agent running in background';
    count = stageAgents;
  } else if (dirName !== null && hasOpenUnendedStage(rows)) {
    reason = 'background task running while a stage is open';
    count = tasks.length;
  } else {
    return { deferred: false };
  }

  if (deferralCeilingReached(input.projectRoot, sessionId, rows, now)) {
    return { deferred: false };
  }

  if (dirName !== null) {
    appendFeatureStageRow(
      input.projectRoot,
      sessionId,
      dirName,
      { kind: COMPLETION_DEFERRED_KIND, reason, tasks: count },
      input.now,
    );
  }
  return { deferred: true, reason, tasks: count };
}

function deferralCeilingReached(
  projectRoot: string,
  sessionId: string,
  rows: readonly SessionLedgerRow[],
  now: () => Date,
): boolean {
  const turnStartedAt = Date.parse(readWorkflowState(projectRoot, sessionId).turn_started_at ?? '');
  let firstDeferredAt = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.kind !== COMPLETION_DEFERRED_KIND) continue;
    const at = Date.parse(rowRecordedAt(row) ?? '');
    if (Number.isNaN(at) || (!Number.isNaN(turnStartedAt) && at < turnStartedAt)) continue;
    firstDeferredAt = Math.min(firstDeferredAt, at);
  }
  return now().getTime() - firstDeferredAt >= CHECKS_RUNNING_CEILING_MS;
}
