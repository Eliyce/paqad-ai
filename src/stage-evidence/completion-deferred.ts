// Completion deferral for background stage agents (issue #615, Part 4).
//
// Since Claude Code 2.1.302, the Desktop app and VS Code always run the main conversation's
// subagents in the BACKGROUND, so the orchestrator's turn can end while a dispatched
// `paqad-<stage>` agent is still working. If a Stop seam (verify-backstop / capability-gate
// completion) judged the change then, it would grade a half-finished change — blocking, or
// reading Inconclusive, and speaking the receipt before the stages finished.
//
// The Stop payload carries `background_tasks` (empty when nothing is in flight). When a
// paqad stage agent is still among them, the seam steps aside: it records one
// `completion-deferred` breadcrumb, computes NO verdict, and runs NO rule-scripts. The stage
// agent's own completion notice (Part 2 recognises it) is what later drives the change on.

import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { stagesWithKind } from './live-writer.js';
import { COMPLETION_DEFERRED_KIND } from './types.js';

/**
 * The fields a background-task entry might use to name its agent type, across Claude Code
 * payload-shape variants (the exact field is captured from a real Desktop payload — a manual
 * check noted in the PR). The first non-empty string one wins.
 */
const AGENT_TYPE_FIELDS = [
  'agent_type',
  'agentType',
  'subagent_type',
  'subagentType',
  'type',
] as const;

/** The agent type a background-task entry names, or `undefined` when it carries none. */
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

/** How many background tasks are a paqad stage agent (agent type starts with `paqad-`). */
export function stageAgentTaskCount(tasks: readonly unknown[]): number {
  return tasks.filter((task) => agentTypeOf(task)?.startsWith('paqad-')).length;
}

/** Whether ANY background task carries a recognisable agent-type field. */
export function tasksCarryAgentType(tasks: readonly unknown[]): boolean {
  return tasks.some((task) => agentTypeOf(task) !== undefined);
}

/** True when any stage in `rows` has a start row and no matching end row. */
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
  /** The Stop payload's `background_tasks` (any shape; a non-array is treated as empty). */
  backgroundTasks: unknown;
  /** Host session id from the Stop payload (resolved/minted when absent). */
  sessionId?: string | null;
  /** Provider adapter (claude-code, codex-cli, …). */
  adapter: string;
  /** Clock seam for tests. */
  now?: () => Date;
}

export interface DeferCompletionResult {
  deferred: boolean;
  reason?: string;
  tasks?: number;
}

/**
 * Decide whether a Stop seam should DEFER its verdict because a stage agent is still running in
 * the background (issue #615, Part 4), appending one `completion-deferred` row when it does.
 *
 *   - At least one `paqad-` stage agent in `background_tasks` → defer (the primary signal).
 *   - No entry carries an agent type at all (an older/other payload shape) AND the session owns
 *     an open bundle with a started-but-unended stage → defer (the defensive fallback).
 *   - Otherwise → do not defer; the seam judges the change as before.
 *
 * Returns `{ deferred: false }` for an empty/missing `background_tasks`, so a Stop on an older
 * Claude Code (no such field) behaves exactly as today.
 */
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

  // Record the breadcrumb against the open change. When no change is active there is nothing to
  // judge anyway, so we still defer but write no row.
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
