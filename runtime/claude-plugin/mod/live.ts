import type { LiveState } from './types';

export type { LiveState };

export const IDLE_LIVE: LiveState = {
  turnId: null,
  turnStartedAt: null,
  editing: null,
  waitingOn: null,
  waitingToolUseId: null,
};

export const QUESTION_TOOL = 'AskUserQuestion';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

export interface LiveToolCall {
  tool: string;
  toolUseId: string | null;
  file: string | null;
}

export function liveToolCall(event: {
  tool?: unknown;
  tool_use_id?: unknown;
  file_path?: unknown;
  notebook_path?: unknown;
}): LiveToolCall {
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  return {
    tool: String(event.tool),
    toolUseId: text(event.tool_use_id),
    file: text(event.file_path) ?? text(event.notebook_path),
  };
}

export function promptSubmitted(state: LiveState, now: number): LiveState {
  return { ...state, turnStartedAt: now };
}

export function turnStarted(state: LiveState, turnId: string, now: number): LiveState {
  return {
    ...IDLE_LIVE,
    turnId,
    turnStartedAt:
      state.turnId === null && state.turnStartedAt !== null ? state.turnStartedAt : now,
  };
}

export function turnEnded(): LiveState {
  return IDLE_LIVE;
}

export function toolStarted(state: LiveState, call: LiveToolCall): LiveState {
  let next =
    state.waitingOn === 'permission'
      ? { ...state, waitingOn: null, waitingToolUseId: null }
      : state;
  if (EDIT_TOOLS.has(call.tool)) {
    next = { ...next, editing: { toolUseId: call.toolUseId, file: call.file } };
  }
  if (call.tool === QUESTION_TOOL) {
    next = { ...next, waitingOn: 'question', waitingToolUseId: call.toolUseId };
  }
  return next;
}

export function toolEnded(state: LiveState, call: LiveToolCall): LiveState {
  let next = state;
  if (EDIT_TOOLS.has(call.tool) && state.editing?.toolUseId === call.toolUseId) {
    next = { ...next, editing: null };
  }
  if (call.tool === QUESTION_TOOL && state.waitingOn === 'question') {
    if (state.waitingToolUseId === call.toolUseId) {
      next = { ...next, waitingOn: null, waitingToolUseId: null };
    }
  }
  return next;
}

export function permissionAsked(
  state: LiveState,
  check: { decision: string; approver?: unknown; toolUseId: string | null },
): LiveState {
  if (check.decision !== 'ask' || check.approver !== 'person') return state;
  return { ...state, waitingOn: 'permission', waitingToolUseId: check.toolUseId };
}

export function questionShown(state: LiveState): LiveState {
  return { ...state, waitingOn: 'question', waitingToolUseId: null };
}

export function questionClosed(state: LiveState): LiveState {
  return state.waitingOn === 'question' && state.waitingToolUseId === null
    ? { ...state, waitingOn: null }
    : state;
}

export function answeredRuleStopText(text: string | null): string | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return `${JSON.stringify({ ...raw, used: true }, null, 2)}\n`;
}
