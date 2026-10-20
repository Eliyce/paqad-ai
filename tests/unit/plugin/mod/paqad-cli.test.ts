import { describe, expect, it } from 'vitest';

import {
  entrySentinelPath,
  freshRuleStop,
  lastBlockPath,
  overrideArgs,
  ruleStopQuestion,
  ruleTextQuestion,
} from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  PAQAD_CLI_TIMEOUT_MS,
  paqadArgv,
  runPaqad,
  type PaqadProcessHost,
  type PaqadVerb,
} from '../../../../runtime/claude-plugin/mod/paqad-cli.ts';

function host(
  answer: { exitCode: number; stdout: string; stderr: string } | Error,
  calls: unknown[] = [],
): PaqadProcessHost {
  return {
    process: {
      run: async (argv, init) => {
        calls.push({ argv, init });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

describe('the mod paqad-ai helper', () => {
  it('builds the argv for an allowed verb and refuses any other', () => {
    expect(paqadArgv('rules override', ['--rule', 'R'])).toEqual([
      'paqad-ai',
      'rules',
      'override',
      '--rule',
      'R',
    ]);
    expect(paqadArgv('stage start' as PaqadVerb, [])).toBeNull();
  });

  it('runs paqad-ai by argument vector with its own timeout', async () => {
    const calls: unknown[] = [];
    const result = await runPaqad(
      host({ exitCode: 0, stdout: 'ok', stderr: '' }, calls),
      'rules override',
      ['--rule', 'R; rm -rf /'],
      '/work',
    );
    expect(result).toEqual({ ok: true, stdout: 'ok', stderr: '' });
    expect(calls).toEqual([
      {
        argv: ['paqad-ai', 'rules', 'override', '--rule', 'R; rm -rf /'],
        init: { cwd: '/work', timeoutMs: PAQAD_CLI_TIMEOUT_MS },
      },
    ]);
    expect(PAQAD_CLI_TIMEOUT_MS).toBe(15_000);
  });

  it('reads a non-zero exit, a rejected start and a disallowed verb as not ok', async () => {
    expect(
      (await runPaqad(host({ exitCode: 1, stdout: '', stderr: 'no' }), 'rules override', [], '/w'))
        .ok,
    ).toBe(false);
    expect(await runPaqad(host(new Error('ENOENT paqad-ai')), 'rules override', [], '/w')).toEqual({
      ok: false,
      stdout: '',
      stderr: 'ENOENT paqad-ai',
    });
    const calls: unknown[] = [];
    expect(
      (
        await runPaqad(
          host({ exitCode: 0, stdout: '', stderr: '' }, calls),
          'x' as PaqadVerb,
          [],
          '/w',
        )
      ).ok,
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reads a thrown non-error as its text', async () => {
    const odd: PaqadProcessHost = {
      process: {
        run: () => Promise.reject('gone'),
      },
    };
    expect((await runPaqad(odd, 'rules override', [], '/w')).stderr).toBe('gone');
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
