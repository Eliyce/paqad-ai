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
  CI_PAUSED_PREFIX,
  CI_WATCH_LIMIT_MS,
  PAQAD_CLI_TIMEOUT_MS,
  ciWatchHead,
  nextCiPoll,
  overrideRecorded,
  refreshReason,
  stopsCiWatch,
  withCiPause,
} from '../../../../runtime/claude-plugin/mod/paqad-cli.ts';
import type { PaqadHudSnapshot } from '../../../../runtime/claude-plugin/mod/types';

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

describe('the CI watch schedule', () => {
  it('AC-5: backs off 30 s, doubling to 5 min, and stops at 60 min', () => {
    const start = 1_000_000;
    let now = start;
    let last: number | null = null;
    const delays: number[] = [];
    for (;;) {
      const next = nextCiPoll(start, last, now);
      if (next === null) break;
      delays.push(next);
      last = next;
      now += next;
    }
    expect(delays.slice(0, 7)).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ]);
    expect(delays.length).toBeLessThanOrEqual(16);
    expect(nextCiPoll(start, 300_000, start + CI_WATCH_LIMIT_MS)).toBeNull();
    expect(nextCiPoll(start, null, start + CI_WATCH_LIMIT_MS - 1)).toBe(30_000);
  });

  it('reads the reason the refresh printed, and which reasons end the watch early', () => {
    expect(refreshReason('{"refreshed":false,"reason":"gh is signed out"}\n')).toBe(
      'gh is signed out',
    );
    expect(refreshReason('noise\n{"refreshed":true,"reason":null}')).toBeNull();
    expect(refreshReason('')).toBeNull();
    expect(refreshReason('{not json')).toBeNull();
    expect(stopsCiWatch('gh is signed out')).toBe(true);
    expect(stopsCiWatch('gh is not installed')).toBe(true);
    expect(stopsCiWatch('gh is rate-limited')).toBe(false);
    expect(stopsCiWatch(null)).toBe(false);
  });

  const pending = (over: Record<string, unknown> = {}) =>
    ({
      active: true,
      headline: { text: 'Done', tone: 'good', gap: null },
      ship: {
        pr: 'open',
        pr_number: 12,
        pr_state: 'open',
        pr_head: 'aaa1111',
        ci_detail: { state: 'pending', done: 1, total: 3 },
        ...over,
      },
    }) as unknown as PaqadHudSnapshot;

  it('watches only an open PR whose CI is pending', () => {
    expect(ciWatchHead(pending())).toBe('aaa1111');
    expect(ciWatchHead(pending({ pr_head: null }))).toBe('');
    expect(ciWatchHead(pending({ ci_detail: { state: 'pass', done: 3, total: 3 } }))).toBeNull();
    expect(ciWatchHead(pending({ ci_detail: { state: 'fail', done: 3, total: 3 } }))).toBeNull();
    expect(ciWatchHead(pending({ pr_state: 'closed' }))).toBeNull();
    expect(ciWatchHead(pending({ pr_state: 'merged' }))).toBeNull();
    expect(ciWatchHead({ ...pending(), active: false } as PaqadHudSnapshot)).toBeNull();
    expect(ciWatchHead(null)).toBeNull();
  });

  it('adds the paused note to the gap line, beside any gap already there', () => {
    const snap = pending();
    expect(withCiPause(snap, null)).toBe(snap);
    expect(withCiPause(snap, 'checked for 60 minutes')!.headline.gap).toBe(
      `${CI_PAUSED_PREFIX}checked for 60 minutes`,
    );
    const gapped = { ...snap, headline: { ...snap.headline, gap: 'paqad could not record x' } };
    expect(withCiPause(gapped, 'gh is signed out')!.headline.gap).toBe(
      'paqad could not record x · CI updates paused: gh is signed out',
    );
    expect(withCiPause(null, 'x')).toBeNull();
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
