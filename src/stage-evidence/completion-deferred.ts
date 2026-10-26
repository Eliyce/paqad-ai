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
import { resolveSessionId } from '@/rag-ledger/session.js';
import { stripPluginAgentNamespace } from '@/stage-isolation/stage-agents.js';

import { stageIsOpen, stagesWithKind } from './live-writer.js';
import { COMPLETION_DEFERRED_KIND, STAGE_AGENT_KIND } from './types.js';

const AGENT_TYPE_FIELDS = ['agent_type', 'agentType', 'subagent_type', 'subagentType'] as const;

// Claude Code writes the task kind (a subagent, a shell) in `type`, not the agent's name, so
// `type` only names an agent when it is not one of those kinds.
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

/**
 * The stage agents of a change that have started (SubagentStart wrote a `started` stage-agent
 * row) and not stopped (no later stage-agent row for the same agent id, or for the same stage
 * when the id is unknown). A start older than the 30 minute ceiling no longer counts, so an agent
 * that died without a stop event cannot hold a change open forever. No clock decides anything
 * else: the stop event is what releases a live agent.
 */
export function liveStageAgents(
  rows: readonly SessionLedgerRow[],
  now: () => Date = () => new Date(),
): LiveStageAgent[] {
  const live: LiveStageAgent[] = [];
  const nowMs = now().getTime();
  rows.forEach((row, index) => {
    if (row.kind !== STAGE_AGENT_KIND || row.event_status !== 'started') return;
    const stage = stringOrNull(row.stage);
    if (stage === null) return;
    const agentId = stringOrNull(row.agent_id);
    const startedAt = rowTime(row);
    if (Number.isNaN(startedAt) || nowMs - startedAt >= CHECKS_RUNNING_CEILING_MS) return;
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
  // A missing, empty or malformed `background_tasks` never means no agent runs: the ledger
  // still answers from the stage agents that started and have not stopped.
  const tasks = runningTasks(Array.isArray(input.backgroundTasks) ? input.backgroundTasks : []);
  const now = input.now ?? (() => new Date());
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId ?? null);
  const checksRunning =
    liveChecksRunningMarker(input.projectRoot, sessionId, { ...input.probe, now }) !== null;
  const dirName = currentFeature(input.projectRoot, sessionId);
  const rows = dirName !== null ? readFeatureStageUnit(input.projectRoot, dirName) : [];
  const ledgerAgents = liveStageAgents(rows, now).length;
  if (tasks.length === 0 && !checksRunning && ledgerAgents === 0) {
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
  } else if (!tasksCarryAgentType(tasks) && dirName !== null && hasOpenUnendedStage(rows)) {
    reason = 'background task running while a stage is open';
    count = tasks.length;
  } else {
    return { deferred: false };
  }

  if (deferralCeilingReached(rows, now)) {
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
