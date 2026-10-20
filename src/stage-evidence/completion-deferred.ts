import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { stagesWithKind } from './live-writer.js';
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

export function tasksCarryAgentType(tasks: readonly unknown[]): boolean {
  return tasks.some((task) => agentTypeOf(task) !== undefined);
}

export function hasOpenUnendedStage(rows: readonly SessionLedgerRow[]): boolean {
  const started = stagesWithKind(rows, 'stage_start');
  const ended = stagesWithKind(rows, 'stage_end');
  for (const stage of started) {
    if (!ended.has(stage)) {
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
  if (tasks.length === 0) {
    return { deferred: false };
  }
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId ?? null);
  const dirName = currentFeature(input.projectRoot, sessionId);

  let reason: string;
  let count: number;
  const stageAgents = stageAgentTaskCount(tasks);
  if (stageAgents > 0) {
    reason = 'stage agent running in background';
    count = stageAgents;
  } else if (
    !tasksCarryAgentType(tasks) &&
    dirName !== null &&
    hasOpenUnendedStage(readFeatureStageUnit(input.projectRoot, dirName))
  ) {
    reason = 'background task running while a stage is open';
    count = tasks.length;
  } else {
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
