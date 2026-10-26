import type { LiveState } from './types';

export type { LiveState };

export const IDLE_LIVE: LiveState = {
  turnId: null,
  turnStartedAt: null,
  editing: null,
  waitingOn: null,
  waitingToolUseId: null,
  waitingAgent: null,
};

export const QUESTION_TOOL = 'AskUserQuestion';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

export const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);

export interface LiveToolCall {
  tool: string;
  toolUseId: string | null;
  file: string | null;
  agent?: string | null;
}

export function liveToolCall(event: {
  tool?: unknown;
  tool_use_id?: unknown;
  file_path?: unknown;
  notebook_path?: unknown;
  agentId?: unknown;
}): LiveToolCall {
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  const agent = text(event.agentId);
  return {
    tool: String(event.tool),
    toolUseId: text(event.tool_use_id),
    file: text(event.file_path) ?? text(event.notebook_path),
    ...(agent ? { agent } : {}),
  };
}

const NOT_WAITING = { waitingOn: null, waitingToolUseId: null, waitingAgent: null } as const;

function waitsOnPermissionFrom(state: LiveState, agent: string | null): boolean {
  return state.waitingOn === 'permission' && state.waitingAgent === agent;
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
  let next: LiveState = waitsOnPermissionFrom(state, call.agent ?? null)
    ? { ...state, ...NOT_WAITING }
    : state;
  if (EDIT_TOOLS.has(call.tool)) {
    next = { ...next, editing: { toolUseId: call.toolUseId, file: call.file } };
  }
  if (call.tool === QUESTION_TOOL) {
    next = { ...next, waitingOn: 'question', waitingToolUseId: call.toolUseId, waitingAgent: null };
  }
  return next;
}

function endsSubagentWait(state: LiveState, call: LiveToolCall): boolean {
  return (
    (call.agent ?? null) === null &&
    AGENT_TOOLS.has(call.tool) &&
    state.waitingOn === 'permission' &&
    state.waitingAgent !== null
  );
}

export function toolEnded(state: LiveState, call: LiveToolCall): LiveState {
  let next: LiveState =
    waitsOnPermissionFrom(state, call.agent ?? null) || endsSubagentWait(state, call)
      ? { ...state, ...NOT_WAITING }
      : state;
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
  check: {
    decision: string;
    approver?: unknown;
    toolUseId: string | null;
    agent?: string | null;
    foreground?: boolean;
  },
): LiveState {
  const agent = check.agent ?? null;
  if (agent !== null && check.foreground !== true) return state;
  const settled = waitsOnPermissionFrom(state, agent) ? { ...state, ...NOT_WAITING } : state;
  if (check.decision !== 'ask' || check.approver !== 'person') return settled;
  return {
    ...settled,
    waitingOn: 'permission',
    waitingToolUseId: check.toolUseId,
    waitingAgent: agent,
  };
}

export function agentTurnEnded(state: LiveState, agent: string): LiveState {
  return waitsOnPermissionFrom(state, agent) ? { ...state, ...NOT_WAITING } : state;
}

export function questionShown(state: LiveState): LiveState {
  return { ...state, waitingOn: 'question', waitingToolUseId: null, waitingAgent: null };
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
