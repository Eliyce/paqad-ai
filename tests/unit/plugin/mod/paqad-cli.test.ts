import { describe, expect, it } from 'vitest';

import {
  editOutcome,
  entrySentinelPath,
  freshRuleStop,
  isAllowedOnce,
  isDenied,
  lastBlockPath,
  outcomeArgs,
  overrideArgs,
  ruleStopQuestion,
  ruleTextQuestion,
} from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  PAQAD_CLI_TIMEOUT_MS,
  overrideRecorded,
} from '../../../../runtime/claude-plugin/mod/paqad-cli.ts';

describe('the mod paqad-ai helper', () => {
  it('counts an override as recorded only when the CLI printed its success line', () => {
    expect(overrideRecorded('**▸ paqad** · recorded a one-time override of RL-1 on a.ts')).toBe(
      true,
    );
    expect(overrideRecorded('{"overridden":true,"rule":"RL-1"}')).toBe(true);
    expect(overrideRecorded('')).toBe(false);
    expect(overrideRecorded('{"overridden":false}')).toBe(false);
  });

  it('gives paqad-ai its own timeout', () => {
    expect(PAQAD_CLI_TIMEOUT_MS).toBe(15_000);
  });
});

describe('the rule stop the mod reads', () => {
  const RECORD = {
    rule: 'RL-1',
    title: 'No comments',
    file: 'src/x.ts',
    tool_use_id: 'tu_1',
    managed: false,
    sole: true,
    token: 't',
    used: false,
    session: 's',
  };
  const text = (over: Record<string, unknown> = {}) => JSON.stringify({ ...RECORD, ...over });

  it('names the session file next to the snapshot', () => {
    expect(lastBlockPath('/work', 's/1')).toBe('/work/.paqad/session/hud/s_1.last-block.json');
  });

  it('names the session entry sentinel the way the entry gate writes it', () => {
    expect(entrySentinelPath('/work', ' s.1/x ')).toBe('/work/.paqad/.agent-entry-loaded.d/s_1_x');
    expect(entrySentinelPath('/work', '  ')).toBe('/work/.paqad/.agent-entry-loaded');
  });

  it('is fresh only for this session, this tool call and an unused token', () => {
    expect(freshRuleStop(text(), 's', 'tu_1')).toEqual({
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/x.ts',
      toolUseId: 'tu_1',
      managed: false,
      sole: true,
      token: 't',
    });
    expect(freshRuleStop(text({ managed: true, title: 3 }), 's', 'tu_1')).toMatchObject({
      managed: true,
      title: null,
    });
    expect(freshRuleStop(text({ sole: 'yes' }), 's', 'tu_1')?.sole).toBe(false);
    for (const [record, session, id] of [
      [text(), 's', 'tu_2'],
      [text(), 'other', 'tu_1'],
      [text({ used: true }), 's', 'tu_1'],
      [text({ token: '' }), 's', 'tu_1'],
      [text(), 's', undefined],
      [null, 's', 'tu_1'],
      ['{', 's', 'tu_1'],
      ['[]', 's', 'tu_1'],
    ] as const) {
      expect(freshRuleStop(record, session, id)).toBeNull();
    }
  });

  it('words the questions and the override arguments', () => {
    const stop = freshRuleStop(text(), 's', 'tu_1')!;
    expect(ruleStopQuestion(stop)).toBe('RL-1 stopped this edit to src/x.ts. What should happen?');
    expect(ruleTextQuestion(stop)).toBe('RL-1: No comments. What should happen?');
    expect(ruleTextQuestion({ ...stop, title: null })).toContain('no rule text recorded');
    expect(overrideArgs(stop, 's', '/w', null)).toEqual([
      '--rule',
      'RL-1',
      '--file',
      'src/x.ts',
      '--token',
      't',
      '--tool-use-id',
      'tu_1',
      '--session',
      's',
      '--project-root',
      '/w',
    ]);
    expect(overrideArgs(stop, 's', '/w', '--odd reason').at(-1)).toBe('--reason=--odd reason');
  });
});

describe('what the mod does after Allow once', () => {
  const STOP = {
    rule: 'RL-1',
    title: null,
    file: 'src/x.ts',
    toolUseId: 'tu_1',
    managed: false,
    sole: true,
    token: 't',
  };

  it('AC-2: reads a deny or an isError result as denied and anything else as not', () => {
    expect(isDenied({ deny: 'no' })).toBe(true);
    expect(isDenied({ deny: '' })).toBe(true);
    expect(isDenied({ result: 'Error: no', isError: true })).toBe(true);
    expect(isDenied({ result: 'ok' })).toBe(false);
    expect(isDenied({ result: 'ok', isError: false })).toBe(false);
    expect(isDenied(null)).toBe(false);
    expect(isDenied('text')).toBe(false);
  });

  it('AC-14: names the outcome from the retry result and whether Claude Code asked', () => {
    expect(editOutcome({ result: 'ok' }, false)).toBe('landed');
    expect(editOutcome({ result: 'ok' }, true)).toBe('landed');
    expect(editOutcome({ isError: true }, true)).toBe('refused');
    expect(editOutcome({ deny: 'no' }, false)).toBe('still-blocked');
  });

  it('AC-15: trusts the override only when the record carries allowed_once for this call', () => {
    const record = (over: Record<string, unknown>) =>
      JSON.stringify({ rule: 'RL-1', tool_use_id: 'tu_1', used: true, ...over });
    expect(isAllowedOnce(record({ allowed_once: true }), STOP)).toBe(true);
    expect(isAllowedOnce(record({}), STOP)).toBe(false);
    expect(isAllowedOnce(record({ allowed_once: 'true' }), STOP)).toBe(false);
    expect(isAllowedOnce(record({ allowed_once: true, tool_use_id: 'tu_2' }), STOP)).toBe(false);
    expect(isAllowedOnce('{not json', STOP)).toBe(false);
    expect(isAllowedOnce(null, STOP)).toBe(false);
  });

  it('AC-14: writes the outcome argv with the same rule, file, call, session and root', () => {
    expect(outcomeArgs(STOP, 's', '/work', 'refused')).toEqual([
      '--outcome',
      'refused',
      '--rule',
      'RL-1',
      '--file',
      'src/x.ts',
      '--tool-use-id',
      'tu_1',
      '--session',
      's',
      '--project-root',
      '/work',
    ]);
  });
});
