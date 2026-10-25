import { describe, expect, it } from 'vitest';
import {
  IDLE_LIVE,
  agentTurnEnded,
  answeredRuleStopText,
  liveToolCall,
  permissionAsked,
  promptSubmitted,
  questionClosed,
  questionShown,
  toolEnded,
  toolStarted,
  turnEnded,
  turnStarted,
} from '../../../../runtime/claude-plugin/mod/live.ts';

const edit = liveToolCall({ tool: 'Edit', tool_use_id: 'tu_1', file_path: '/work/src/a.ts' });
const ask = liveToolCall({ tool: 'AskUserQuestion', tool_use_id: 'tu_q' });

describe('live session state', () => {
  it('reads the tool, its call id and the file being edited', () => {
    expect(edit).toEqual({ tool: 'Edit', toolUseId: 'tu_1', file: '/work/src/a.ts' });
    expect(
      liveToolCall({ tool: 'NotebookEdit', notebook_path: '/work/n.ipynb', tool_use_id: '' }),
    ).toEqual({ tool: 'NotebookEdit', toolUseId: null, file: '/work/n.ipynb' });
  });

  it('a turn start records the turn and keeps the prompt time it follows', () => {
    const prompted = promptSubmitted(IDLE_LIVE, 100);
    expect(turnStarted(prompted, 'turn-1', 150)).toEqual({
      ...IDLE_LIVE,
      turnId: 'turn-1',
      turnStartedAt: 100,
    });
    expect(turnStarted(IDLE_LIVE, 'turn-1', 150).turnStartedAt).toBe(150);
    const running = turnStarted(prompted, 'turn-1', 150);
    expect(turnStarted(running, 'turn-2', 200).turnStartedAt).toBe(200);
    expect(turnEnded()).toEqual(IDLE_LIVE);
  });

  it('an edit is current from its start until its own call ends', () => {
    const editing = toolStarted(IDLE_LIVE, edit);
    expect(editing.editing).toEqual({ toolUseId: 'tu_1', file: '/work/src/a.ts' });
    const other = liveToolCall({ tool: 'Edit', tool_use_id: 'tu_2' });
    expect(toolEnded(editing, other).editing).not.toBeNull();
    expect(toolEnded(editing, edit).editing).toBeNull();
    expect(toolStarted(IDLE_LIVE, liveToolCall({ tool: 'Read' }))).toEqual(IDLE_LIVE);
  });

  it('a question waits for the person until its call ends', () => {
    const waiting = toolStarted(IDLE_LIVE, ask);
    expect(waiting.waitingOn).toBe('question');
    expect(toolEnded(waiting, liveToolCall({ tool: 'AskUserQuestion', tool_use_id: 'x' }))).toBe(
      waiting,
    );
    expect(toolEnded(waiting, ask).waitingOn).toBeNull();
  });

  it('only an ask a person answers waits for permission', () => {
    const asked = permissionAsked(IDLE_LIVE, {
      decision: 'ask',
      approver: 'person',
      toolUseId: 't',
    });
    expect(asked).toMatchObject({ waitingOn: 'permission', waitingToolUseId: 't' });
    expect(
      permissionAsked(IDLE_LIVE, { decision: 'ask', approver: 'host', toolUseId: 't' }),
    ).toEqual(IDLE_LIVE);
    expect(
      permissionAsked(IDLE_LIVE, { decision: 'allow', approver: 'person', toolUseId: 't' }),
    ).toEqual(IDLE_LIVE);
  });

  it('the next tool start clears a permission wait, whoever answered it', () => {
    const asked = permissionAsked(IDLE_LIVE, {
      decision: 'ask',
      approver: 'person',
      toolUseId: 't',
    });
    expect(
      toolStarted(asked, liveToolCall({ tool: 'Bash', tool_use_id: 't' })).waitingOn,
    ).toBeNull();
  });

  it('the mod’s own question waits until it closes', () => {
    const shown = questionShown(IDLE_LIVE);
    expect(shown.waitingOn).toBe('question');
    expect(questionClosed(shown).waitingOn).toBeNull();
    const engineQuestion = toolStarted(IDLE_LIVE, ask);
    expect(questionClosed(engineQuestion)).toBe(engineQuestion);
  });
});

describe('answeredRuleStopText', () => {
  it('writes the stop back as used, keeping every other field', () => {
    const text = answeredRuleStopText(JSON.stringify({ rule: 'RL-1', token: 't', used: false }));
    expect(JSON.parse(text!)).toEqual({ rule: 'RL-1', token: 't', used: true });
    expect(text!.endsWith('\n')).toBe(true);
  });

  it('leaves a missing or unreadable stop alone', () => {
    expect(answeredRuleStopText(null)).toBeNull();
    expect(answeredRuleStopText('{not json')).toBeNull();
    expect(answeredRuleStopText('[1]')).toBeNull();
    expect(answeredRuleStopText('null')).toBeNull();
  });
});

describe('which agent asked for permission', () => {
  const askFrom = (agent: string | null, toolUseId = 'tu_1') => ({
    decision: 'ask',
    approver: 'person',
    toolUseId,
    agent,
  });

  it('records the agent that asked, and main as no agent', () => {
    expect(permissionAsked(IDLE_LIVE, askFrom('agent-a1'))).toMatchObject({
      waitingOn: 'permission',
      waitingAgent: 'agent-a1',
    });
    expect(permissionAsked(IDLE_LIVE, askFrom(null))).toMatchObject({
      waitingOn: 'permission',
      waitingAgent: null,
    });
  });

  it("clears a background agent's ask at its next settled check, tool start or turn end", () => {
    const asked = permissionAsked(IDLE_LIVE, askFrom('agent-a1'));
    expect(
      permissionAsked(asked, {
        decision: 'allow',
        approver: 'person',
        toolUseId: 'x',
        agent: 'agent-a1',
      }),
    ).toEqual(IDLE_LIVE);
    expect(
      toolStarted(asked, liveToolCall({ tool: 'Bash', tool_use_id: 'tu_1', agentId: 'agent-a1' })),
    ).toEqual(IDLE_LIVE);
    expect(agentTurnEnded(asked, 'agent-a1')).toEqual(IDLE_LIVE);
    expect(agentTurnEnded(asked, 'agent-b2')).toBe(asked);
    expect(toolStarted(asked, liveToolCall({ tool: 'Bash' })).waitingOn).toBe('permission');
  });

  it('keeps a main-thread wait while background agents ask or work', () => {
    const main = permissionAsked(IDLE_LIVE, askFrom(null, 'tu_m'));
    expect(permissionAsked(main, askFrom('agent-a1', 'tu_a'))).toBe(main);
    expect(
      toolStarted(main, liveToolCall({ tool: 'Read', tool_use_id: 'tu_a', agentId: 'agent-a1' })),
    ).toEqual(main);
    expect(toolStarted(main, liveToolCall({ tool: 'Bash', tool_use_id: 'tu_m' }))).toEqual(
      IDLE_LIVE,
    );
    const question = questionShown(IDLE_LIVE);
    expect(permissionAsked(question, askFrom('agent-a1')).waitingOn).toBe('question');
  });

  it('a main ask takes over from a background wait', () => {
    const background = permissionAsked(IDLE_LIVE, askFrom('agent-a1'));
    expect(permissionAsked(background, askFrom(null, 'tu_m'))).toMatchObject({
      waitingAgent: null,
      waitingToolUseId: 'tu_m',
    });
  });
});
