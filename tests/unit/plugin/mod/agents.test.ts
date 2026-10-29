import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_LINES,
  activityLine,
  finishedSince,
  pushActivity,
  runningAgents,
  subagentTitle,
  toolLine,
} from '../../../../runtime/claude-plugin/mod/agents.ts';

const agent = (id: string, status: string, description = `task ${id}`) => ({
  id,
  status,
  description,
});

describe('the subagents the HUD shows', () => {
  it('keeps only the agents still at work, and titles the newest one', () => {
    const list = [
      agent('a', 'completed'),
      agent('b', 'running', 'Review the change'),
      agent('c', 'pending', 'Run the checks\nwith more words'),
      agent('d', 'idle'),
      agent('e', 'killed'),
    ];
    expect(runningAgents(list).map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(subagentTitle(runningAgents(list))).toBe('Subagent: Run the checks');
    expect(subagentTitle([])).toBeNull();
    expect(subagentTitle([agent('x', 'running', '   ')])).toBe('Subagent: background task');
  });

  it('counts an agent as finished once it leaves the list or stops working', () => {
    const now = [agent('b', 'running'), agent('c', 'completed')];
    expect(finishedSince(['a', 'b', 'c'], now)).toEqual(['a', 'c']);
    expect(finishedSince([], now)).toEqual([]);
  });

  it('builds one line per row from a tool call or an appended row', () => {
    expect(toolLine('Bash', { command: 'pnpm test\n--run' })).toBe('Bash: pnpm test');
    expect(toolLine('Edit', { file_path: '/repo/src/a.ts' })).toBe('Edit: /repo/src/a.ts');
    expect(toolLine('Read', {})).toBe('Read');
    expect(
      activityLine({ content: [{ type: 'text', text: '\n  Looking at   the strip.\nMore' }] }),
    ).toBe('Looking at the strip.');
    expect(
      activityLine({
        content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'ciWatch' } }],
      }),
    ).toBe('Grep: ciWatch');
    expect(activityLine({ content: [{ type: 'tool_result', content: 'x' }] })).toBeNull();
    expect(activityLine({ content: 'nope' })).toBeNull();
  });

  it('skips a system reminder and takes the next block that has a line', () => {
    const reminder = {
      type: 'text',
      text: '<system-reminder>\nThe date is today.\n</system-reminder>',
    };
    expect(activityLine({ content: [reminder, { type: 'text', text: 'Reading the plan' }] })).toBe(
      'Reading the plan',
    );
    expect(
      activityLine({
        content: [
          { type: 'text', text: '\n   <system-reminder>Be brief.</system-reminder>' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/plan.json' } },
        ],
      }),
    ).toBe('Read: /repo/plan.json');
    expect(activityLine({ content: [reminder] })).toBeNull();
    expect(activityLine({ content: [reminder, { ...reminder }] })).toBeNull();
  });

  it('keeps one line, the newest, and never repeats it', () => {
    expect(ACTIVITY_LINES).toBe(1);
    let lines: string[] = [];
    for (const line of ['one', 'two', 'two', null, 'three']) lines = pushActivity(lines, line);
    expect(lines).toEqual(['three']);
    expect(pushActivity(['one'], 'two')).toEqual(['two']);
  });
});
