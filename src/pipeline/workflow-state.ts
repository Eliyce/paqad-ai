import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE, type StageLane } from '@/stage-evidence/types.js';

import { ROUTED_WORKFLOWS, type RoutedWorkflow } from './routed-workflow.js';

const WORKFLOW_STATE_FILE = '.workflow-state.json';

export interface WorkflowEntry {
  workflow: RoutedWorkflow;
  changeKey?: string;
  lane?: StageLane;
  specId?: string;
  discoveryRunId?: string;
  reason?: string;
}

export interface WorkflowState {
  active: WorkflowEntry | null;
  paused: WorkflowEntry[];
  turn_started_at?: string;
}

export interface RouteTransition {
  state: WorkflowState;
  resumed: WorkflowEntry | null;
  switched: boolean;
}

const EMPTY_STATE: WorkflowState = { active: null, paused: [] };

function workflowStatePath(projectRoot: string, sessionId: string): string {
  return join(
    projectRoot,
    sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId),
    WORKFLOW_STATE_FILE,
  );
}

const VALID_WORKFLOWS = new Set<string>(ROUTED_WORKFLOWS);

function isRoutedWorkflow(value: unknown): value is RoutedWorkflow {
  return typeof value === 'string' && VALID_WORKFLOWS.has(value);
}

function toEntry(value: unknown): WorkflowEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isRoutedWorkflow(record.workflow)) {
    return null;
  }
  const entry: WorkflowEntry = { workflow: record.workflow };
  if (typeof record.changeKey === 'string') {
    entry.changeKey = record.changeKey;
  }
  if (record.lane === 'fast' || record.lane === 'graduated' || record.lane === 'full') {
    entry.lane = record.lane;
  }
  if (typeof record.specId === 'string') {
    entry.specId = record.specId;
  }
  if (typeof record.discoveryRunId === 'string') {
    entry.discoveryRunId = record.discoveryRunId;
  }
  if (typeof record.reason === 'string') {
    entry.reason = record.reason;
  }
  return entry;
}

export function readWorkflowState(projectRoot: string, sessionId: string): WorkflowState {
  try {
    const parsed = JSON.parse(readFileSync(workflowStatePath(projectRoot, sessionId), 'utf8')) as {
      active?: unknown;
      paused?: unknown;
      turn_started_at?: unknown;
    };
    const active = toEntry(parsed.active);
    const paused = Array.isArray(parsed.paused)
      ? parsed.paused.map(toEntry).filter((entry): entry is WorkflowEntry => entry !== null)
      : [];
    const state: WorkflowState = { active, paused };
    if (typeof parsed.turn_started_at === 'string') {
      state.turn_started_at = parsed.turn_started_at;
    }
    return state;
  } catch {
    return { ...EMPTY_STATE, paused: [] };
  }
}

export function writeWorkflowState(
  projectRoot: string,
  sessionId: string,
  state: WorkflowState,
): void {
  const path = workflowStatePath(projectRoot, sessionId);
  mkdirSync(join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId)), {
    recursive: true,
  });
  writeFileSync(path, JSON.stringify(state), 'utf8');
}

export function routeWorkflow(
  state: WorkflowState,
  next: RoutedWorkflow,
  anchors: Omit<WorkflowEntry, 'workflow'> = {},
): RouteTransition {
  if (state.active && state.active.workflow === next) {
    const merged: WorkflowEntry = { ...state.active, ...stripUndefined(anchors) };
    return { state: { active: merged, paused: state.paused }, resumed: null, switched: false };
  }

  const pausedIndex = state.paused.findIndex((entry) => entry.workflow === next);
  const carriedForward = state.active
    ? [...state.paused.filter((_, index) => index !== pausedIndex), state.active]
    : state.paused.filter((_, index) => index !== pausedIndex);

  if (pausedIndex >= 0) {
    const resumed = state.paused[pausedIndex]!;
    return { state: { active: resumed, paused: carriedForward }, resumed, switched: true };
  }

  const active: WorkflowEntry = { workflow: next, ...stripUndefined(anchors) };
  return {
    state: { active, paused: carriedForward },
    resumed: null,
    switched: Boolean(state.active),
  };
}

function stripUndefined(anchors: Omit<WorkflowEntry, 'workflow'>): Omit<WorkflowEntry, 'workflow'> {
  const out: Omit<WorkflowEntry, 'workflow'> = {};
  if (anchors.changeKey !== undefined) {
    out.changeKey = anchors.changeKey;
  }
  if (anchors.lane !== undefined) {
    out.lane = anchors.lane;
  }
  if (anchors.specId !== undefined) {
    out.specId = anchors.specId;
  }
  if (anchors.discoveryRunId !== undefined) {
    out.discoveryRunId = anchors.discoveryRunId;
  }
  if (anchors.reason !== undefined) {
    out.reason = anchors.reason;
  }
  return out;
}
