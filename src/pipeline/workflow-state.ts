// Per-session workflow-routing state (issue #336).
//
// Routing runs on EVERY user message and is stateful: the user can be deep in a
// feature, stop to ask a question, then say "carry on" and expect the feature to
// continue where it paused. This store holds the active routed workflow plus a
// stack of paused ones, keyed by session id, in the (git-ignored) ledger dir —
// modelled on the pending-lane stash. Each entry carries the resume anchors that
// let feature-development pick up its exact change: the stage-ledger change key,
// the lane, and the frozen-spec id (all already persisted elsewhere by
// src/stage-evidence — this only records the pointers so a resume is deterministic).
//
// Switching PAUSES (push the active entry), it does not reset. Resuming POPS the
// paused entry (its anchors intact). A never-written or unreadable state reads as
// the empty default; the read never throws into the caller.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE, type StageLane } from '@/stage-evidence/types.js';

import { ROUTED_WORKFLOWS, type RoutedWorkflow } from './routed-workflow.js';

const WORKFLOW_STATE_FILE = '.workflow-state.json';

/** One routed workflow plus the anchors needed to resume it (feature-development). */
export interface WorkflowEntry {
  workflow: RoutedWorkflow;
  /** The stage-ledger change key (`<sessionId>#<ordinal>`) this workflow opened, if any. */
  changeKey?: string;
  /** The lane picked for this workflow (feature-development only). */
  lane?: StageLane;
  /** The frozen-spec id backing this change, if any. */
  specId?: string;
}

/** The active routed workflow plus a stack of paused ones (most-recent last). */
export interface WorkflowState {
  active: WorkflowEntry | null;
  paused: WorkflowEntry[];
}

/** The result of applying a route to a state: the new state, and what happened. */
export interface RouteTransition {
  state: WorkflowState;
  /** The paused entry that was resumed (popped), or null when not a resume. */
  resumed: WorkflowEntry | null;
  /** True when the active workflow changed (a pause-and-switch or a resume). */
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

/** Coerce an unknown parsed value into a valid {@link WorkflowEntry}, or null. */
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
  return entry;
}

/** Read the workflow state for `sessionId`, or the empty default when absent/invalid. */
export function readWorkflowState(projectRoot: string, sessionId: string): WorkflowState {
  try {
    const parsed = JSON.parse(readFileSync(workflowStatePath(projectRoot, sessionId), 'utf8')) as {
      active?: unknown;
      paused?: unknown;
    };
    const active = toEntry(parsed.active);
    const paused = Array.isArray(parsed.paused)
      ? parsed.paused.map(toEntry).filter((entry): entry is WorkflowEntry => entry !== null)
      : [];
    return { active, paused };
  } catch {
    return { ...EMPTY_STATE, paused: [] };
  }
}

/** Persist the workflow state for `sessionId`. Creates the session dir on demand. */
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

/**
 * Apply a routed workflow to the current state (pure). Semantics:
 *
 *  - Routing to the SAME active workflow continues it (anchors are merged in, so a
 *    later stage can stamp the change key / lane / spec id). Not a switch.
 *  - Routing to a workflow already on the paused stack RESUMES it: the entry is
 *    popped (with its anchors intact and returned as `resumed`) and the previously
 *    active workflow is paused in its place.
 *  - Routing to a new workflow PAUSES the active one (pushed onto the stack) and
 *    activates the new one. Not a reset — the paused entry keeps its anchors.
 *
 * The deterministic seam supplies the routed outcome; the model, guided by the
 * bootstrap, decides intent (a "continue" resumes; a fresh code request is new
 * work). This function only provides the mechanism.
 */
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

/** Drop keys whose value is undefined so they never overwrite an existing anchor. */
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
  return out;
}
