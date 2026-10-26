import {
  CHECKS_RUNNING_CEILING_MS,
  liveChecksRunningMarker,
  type ChecksMarkerProbe,
} from '@/checks/running-marker.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { readContractDecisions } from '@/decisions/authoring.js';
import { isBundleClosed } from '@/feature-evidence/adoption.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  currentFeature,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { stripPluginAgentNamespace } from '@/stage-isolation/stage-agents.js';

import { stageIsOpen, stagesWithKind } from './live-writer.js';
import { COMPLETION_DEFERRED_KIND, STAGE_AGENT_KIND } from './types.js';

const AGENT_TYPE_FIELDS = ['agent_type', 'agentType', 'subagent_type', 'subagentType'] as const;

const TASK_KINDS: ReadonlySet<string> = new Set([
  'subagent',
  'agent',
  'task',
  'local_agent',
  'remote_agent',
  'bash',
  'local_bash',
  'shell',
]);

const FINISHED_TASK_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'killed',
  'stopped',
  'cancelled',
  'canceled',
]);

function agentTypeOf(task: unknown): string | undefined {
  if (!task || typeof task !== 'object') {
    return undefined;
  }
  const record = task as Record<string, unknown>;
  for (const field of AGENT_TYPE_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return stripPluginAgentNamespace(value.trim());
    }
  }
  const kind = record.type;
  if (typeof kind === 'string' && kind.trim() !== '' && !TASK_KINDS.has(kind.trim())) {
    return stripPluginAgentNamespace(kind.trim());
  }
  return undefined;
}

function taskIsFinished(task: unknown): boolean {
  if (!task || typeof task !== 'object') {
    return false;
  }
  const status = (task as Record<string, unknown>).status;
  return typeof status === 'string' && FINISHED_TASK_STATUSES.has(status.trim().toLowerCase());
}

function runningTasks(tasks: readonly unknown[]): unknown[] {
  return tasks.filter((task) => !taskIsFinished(task));
}

export function stageAgentTaskCount(tasks: readonly unknown[]): number {
  return runningTasks(tasks).filter((task) => agentTypeOf(task)?.startsWith('paqad-')).length;
}

export function tasksCarryAgentType(tasks: readonly unknown[]): boolean {
  return runningTasks(tasks).some((task) => agentTypeOf(task) !== undefined);
}

export interface LiveStageAgent {
  stage: string;
  agentId: string | null;
  startedAt: string;
}

function rowTime(row: SessionLedgerRow): number {
  return Date.parse(rowRecordedAt(row) ?? '');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function liveStageAgents(rows: readonly SessionLedgerRow[]): LiveStageAgent[] {
  const live: LiveStageAgent[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== STAGE_AGENT_KIND || row.event_status !== 'started') return;
    const stage = stringOrNull(row.stage);
    if (stage === null) return;
    const agentId = stringOrNull(row.agent_id);
    if (Number.isNaN(rowTime(row))) return;
    const stopped = rows.slice(index + 1).some((later) => {
      if (later.kind !== STAGE_AGENT_KIND || later.event_status === 'started') return false;
      const laterId = stringOrNull(later.agent_id);
      return agentId !== null && laterId !== null ? laterId === agentId : later.stage === stage;
    });
    if (!stopped) live.push({ stage, agentId, startedAt: rowRecordedAt(row)! });
  });
  return live;
}

export function hasOpenUnendedStage(rows: readonly SessionLedgerRow[]): boolean {
  for (const stage of stagesWithKind(rows, 'stage_start')) {
    if (stageIsOpen(rows, stage)) {
      return true;
    }
  }
  return false;
}

const CLEANLY_ENDED: ReadonlySet<string> = new Set(['complete', 'redone']);
const NOT_REACHED: ReadonlySet<string> = new Set(['missing', 'not-applicable', 'skipped']);

export function isBetweenStages(projectRoot: string, sessionId: string, dirName: string): boolean {
  if (isBundleClosed(projectRoot, dirName)) return false;
  const fold = foldFeature(projectRoot, sessionId, dirName);
  if (fold.lane === null || fold.completeness.missing_stages.length === 0) return false;
  const reached = fold.stages.filter((stage) => !NOT_REACHED.has(stage.state));
  return reached.length > 0 && reached.every((stage) => CLEANLY_ENDED.has(stage.state));
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
  nextStage?: string;
}

function pendingDecisionOf(projectRoot: string, dirName: string): boolean {
  const key = featureChangeKey(dirName);
  return readContractDecisions(projectRoot).some(
    ({ packet, status }) =>
      status !== 'resolved' && (packet as unknown as Record<string, unknown>).change === key,
  );
}

export function deferCompletionForBackgroundStage(
  input: DeferCompletionInput,
): DeferCompletionResult {
  const tasks = runningTasks(Array.isArray(input.backgroundTasks) ? input.backgroundTasks : []);
  const now = input.now ?? (() => new Date());
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId ?? null);
  const checksRunning =
    liveChecksRunningMarker(input.projectRoot, sessionId, { ...input.probe, now }) !== null;
  const dirName = currentFeature(input.projectRoot, sessionId);
  const rows = dirName !== null ? readFeatureStageUnit(input.projectRoot, dirName) : [];
  const payloadNamesAgents = tasks.length > 0 && tasksCarryAgentType(tasks);
  const ledgerAgents = payloadNamesAgents ? 0 : liveStageAgents(rows).length;
  const betweenStages =
    dirName !== null &&
    !hasOpenUnendedStage(rows) &&
    isBetweenStages(input.projectRoot, sessionId, dirName);
  if (tasks.length === 0 && !checksRunning && ledgerAgents === 0 && !betweenStages) {
    return { deferred: false };
  }

  let reason: string;
  let count: number;
  const stageAgents = stageAgentTaskCount(tasks);
  if (checksRunning) {
    reason = 'checks run still running';
    count = tasks.length;
  } else if (stageAgents > 0) {
    reason = 'stage agent running in background';
    count = stageAgents;
  } else if (ledgerAgents > 0) {
    reason = 'stage agent running in background';
    count = ledgerAgents;
  } else if (betweenStages) {
    reason = 'between stages';
    count = tasks.length;
  } else if (!tasksCarryAgentType(tasks) && dirName !== null && hasOpenUnendedStage(rows)) {
    reason = 'background task running while a stage is open';
    count = tasks.length;
  } else {
    return { deferred: false };
  }

  const clockFree = reason === 'between stages' || (stageAgents === 0 && ledgerAgents > 0);
  if (!clockFree && deferralCeilingReached(rows, now)) {
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
  const next =
    reason === 'between stages' &&
    dirName !== null &&
    !pendingDecisionOf(input.projectRoot, dirName)
      ? foldFeature(input.projectRoot, sessionId, dirName).completeness.missing_stages[0]
      : undefined;
  return { deferred: true, reason, tasks: count, ...(next ? { nextStage: next } : {}) };
}

function deferralCeilingReached(rows: readonly SessionLedgerRow[], now: () => Date): boolean {
  let firstDeferredAt = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.kind === 'verify') {
      firstDeferredAt = Number.POSITIVE_INFINITY;
      continue;
    }
    if (row.kind !== COMPLETION_DEFERRED_KIND) continue;
    const at = Date.parse(rowRecordedAt(row)!);
    if (Number.isNaN(at)) continue;
    firstDeferredAt = Math.min(firstDeferredAt, at);
  }
  return now().getTime() - firstDeferredAt >= CHECKS_RUNNING_CEILING_MS;
}
