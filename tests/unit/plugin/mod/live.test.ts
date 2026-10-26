import { describe, expect, it } from 'vitest';
import {
  ForegroundAgents,
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

  it('AC-14: a main-session ask waits, keyed by its request, with no clock', () => {
    expect(permissionAsked(IDLE_LIVE, askFrom(null))).toMatchObject({
      waitingOn: 'permission',
      waitingAgent: null,
      waitingToolUseId: 'tu_1',
    });
  });

  it('AC-13: an ask from a subagent never sets the wait (Claude Code shows that prompt itself)', () => {
    expect(permissionAsked(IDLE_LIVE, askFrom('agent-a1'))).toEqual(IDLE_LIVE);
  });

  it('AC-13: a main ask denied with Esc clears on the next event of the main session', () => {
    const asked = permissionAsked(IDLE_LIVE, askFrom(null, 'tu_m'));
    expect(
      permissionAsked(asked, {
        decision: 'deny',
        approver: 'person',
        toolUseId: 'tu_m',
        agent: null,
      }).waitingOn,
    ).toBeNull();
    expect(
      toolEnded(asked, liveToolCall({ tool: 'Bash', tool_use_id: 'tu_m' })).waitingOn,
    ).toBeNull();
    expect(turnEnded().waitingOn).toBeNull();
  });

  it('AC-13: an ask auto mode decides clears on its own decision or the next main event', () => {
    const asked = permissionAsked(IDLE_LIVE, askFrom(null, 'tu_m'));
    expect(
      permissionAsked(asked, {
        decision: 'allow',
        approver: 'host',
        toolUseId: 'tu_m',
        agent: null,
      }).waitingOn,
    ).toBeNull();
    expect(
      permissionAsked(asked, {
        decision: 'allow',
        approver: 'host',
        toolUseId: 'tu_x',
        agent: null,
      }).waitingOn,
    ).toBeNull();
  });

  it('keeps a main-thread wait while background agents ask or work', () => {
    const main = permissionAsked(IDLE_LIVE, askFrom(null, 'tu_m'));
    expect(permissionAsked(main, askFrom('agent-a1', 'tu_a'))).toBe(main);
    expect(agentTurnEnded(main, 'agent-a1')).toBe(main);
    expect(
      toolStarted(main, liveToolCall({ tool: 'Read', tool_use_id: 'tu_a', agentId: 'agent-a1' })),
    ).toEqual(main);
    expect(toolStarted(main, liveToolCall({ tool: 'Bash', tool_use_id: 'tu_m' }))).toEqual(
      IDLE_LIVE,
    );
    const question = questionShown(IDLE_LIVE);
    expect(permissionAsked(question, askFrom('agent-a1')).waitingOn).toBe('question');
  });

  it('FR-18 / AC-14: an ask from a foreground subagent the main thread waits on does wait', () => {
    const asked = permissionAsked(IDLE_LIVE, { ...askFrom('agent-a1', 'tu_a'), foreground: true });
    expect(asked).toMatchObject({
      waitingOn: 'permission',
      waitingAgent: 'agent-a1',
      waitingToolUseId: 'tu_a',
    });
    expect(
      toolStarted(asked, liveToolCall({ tool: 'Bash', tool_use_id: 'tu_a', agentId: 'agent-a1' })),
    ).toEqual(IDLE_LIVE);
    expect(agentTurnEnded(asked, 'agent-a1')).toEqual(IDLE_LIVE);
    expect(toolEnded(asked, liveToolCall({ tool: 'Agent', tool_use_id: 'tu_agent' }))).toEqual(
      IDLE_LIVE,
    );
    expect(toolEnded(asked, liveToolCall({ tool: 'Read', tool_use_id: 'tu_r' }))).toBe(asked);
  });

  it('AC-13: a background subagent ask still never waits', () => {
    expect(permissionAsked(IDLE_LIVE, { ...askFrom('agent-a1'), foreground: false })).toEqual(
      IDLE_LIVE,
    );
  });

  it('a second main ask replaces the first', () => {
    const first = permissionAsked(IDLE_LIVE, askFrom(null, 'tu_1'));
    expect(permissionAsked(first, askFrom(null, 'tu_2'))).toMatchObject({
      waitingAgent: null,
      waitingToolUseId: 'tu_2',
    });
  });
});

describe('which agent a foreground Agent call is waiting on', () => {
  it('binds the first new agent seen during one open foreground call, and no other', () => {
    const agents = new ForegroundAgents();
    agents.agentSeen('agent-bg');
    const call = agents.callStarted();
    agents.agentSeen('agent-bg');
    expect(agents.isForeground('agent-bg')).toBe(false);
    agents.agentSeen('agent-dev');
    agents.agentSeen('agent-late');
    expect(agents.isForeground('agent-dev')).toBe(true);
    expect(agents.isForeground('agent-late')).toBe(false);
    agents.callEnded(call);
    expect(agents.isForeground('agent-dev')).toBe(false);
  });

  it('binds nothing while two foreground calls are both unbound, and forgets all on clear', () => {
    const agents = new ForegroundAgents();
    agents.callStarted();
    const second = agents.callStarted();
    agents.agentSeen('agent-a');
    expect(agents.isForeground('agent-a')).toBe(false);
    agents.callEnded(second);
    agents.callEnded(second);
    agents.agentSeen('agent-b');
    expect(agents.isForeground('agent-b')).toBe(true);
    agents.clear();
    expect(agents.isForeground('agent-b')).toBe(false);
  });
});
