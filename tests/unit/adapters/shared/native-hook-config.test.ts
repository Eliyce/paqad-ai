import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildNativeHookConfigFile,
  mergeNativeHooks,
} from '@/adapters/shared/native-hook-config.js';
import {
  buildHostHookChain,
  capabilityGateCommand,
  completionRecordCommand,
  DEFAULT_HOOK_ADAPTER,
  hookCommand,
  NATIVE_HOOK_EVENTS,
  PAQAD_HOOK_EVENT_ORDER,
  rendersFullHookChain,
  type RenderedHook,
} from '@/adapters/shared/paqad-hooks.js';

const ENV = { PAQAD_FRAMEWORK_HOME: '/fake/home/.paqad-ai/current' } as NodeJS.ProcessEnv;

describe('paqad-hooks command builders (issue #566)', () => {
  it('capabilityGateCommand appends the host argv only for a non-default host', () => {
    expect(capabilityGateCommand('pre-mutation', undefined, ENV)).toBe(
      'node "/fake/home/.paqad-ai/current/hooks/capability-gate.mjs" pre-mutation',
    );
    // The default host is never appended (keeps Claude byte-identical).
    expect(capabilityGateCommand('completion', DEFAULT_HOOK_ADAPTER, ENV)).toBe(
      'node "/fake/home/.paqad-ai/current/hooks/capability-gate.mjs" completion',
    );
    expect(capabilityGateCommand('pre-mutation', 'codex-cli', ENV)).toBe(
      'node "/fake/home/.paqad-ai/current/hooks/capability-gate.mjs" pre-mutation codex-cli',
    );
  });

  it('completionRecordCommand appends the adapter only when given', () => {
    expect(completionRecordCommand(undefined, ENV)).toBe(
      'node "/fake/home/.paqad-ai/current/hooks/verification-record.mjs"',
    );
    expect(completionRecordCommand('gemini-cli', ENV)).toBe(
      'node "/fake/home/.paqad-ai/current/hooks/verification-record.mjs" gemini-cli',
    );
  });

  it('rendersFullHookChain is true only for the pre-and-completion hosts', () => {
    expect(rendersFullHookChain('claude-code')).toBe(true);
    expect(rendersFullHookChain('codex-cli')).toBe(true);
    expect(rendersFullHookChain('gemini-cli')).toBe(false);
    expect(rendersFullHookChain('cursor')).toBe(false);
  });

  const distinctEvents = (chain: RenderedHook[]): string[] => {
    const seen: string[] = [];
    for (const hook of chain) {
      if (!seen.includes(hook.nativeEvent)) seen.push(hook.nativeEvent);
    }
    return seen;
  };

  it('buildHostHookChain renders every event in the fixed order and throws for an unknown host', () => {
    // Stage isolation is core-engine behavior (issue #567) — the subagent-completion event is
    // rendered unconditionally, so the chain always covers the full event order.
    const chain = buildHostHookChain('claude-code', ENV);
    expect(distinctEvents(chain)).toEqual(
      PAQAD_HOOK_EVENT_ORDER.map((event) => NATIVE_HOOK_EVENTS['claude-code'].nativeEvent[event]),
    );
    expect(() => buildHostHookChain('nope-host', ENV)).toThrow(/no native hook event map/);
  });

  it('buildHostHookChain renders SubagentStop (agent-type matched) last, after Stop', () => {
    const chain = buildHostHookChain('claude-code', ENV);
    // SubagentStop is appended last, after Stop, matching the full event order.
    expect(distinctEvents(chain).at(-1)).toBe('SubagentStop');
    const subagent = chain.find((hook) => hook.nativeEvent === 'SubagentStop');
    expect(subagent?.matcher).toBe('^paqad-');
    expect(subagent?.command).toContain('stage-agent-completion.mjs');
  });

  it('the Codex chain gets the same SubagentStop matcher and host argv', () => {
    const chain = buildHostHookChain('codex-cli', ENV);
    const subagent = chain.find((hook) => hook.nativeEvent === 'SubagentStop');
    expect(subagent?.matcher).toBe('^paqad-');
    expect(subagent?.command).toContain('stage-agent-completion.mjs');
    expect(subagent?.command).toMatch(/ codex-cli$/);
  });
});

describe('mergeNativeHooks (issue #566)', () => {
  const chain: RenderedHook[] = [
    { nativeEvent: 'PreToolUse', matcher: 'X', command: 'node paqad-a' },
    { nativeEvent: 'Stop', command: 'node paqad-b' },
  ];

  it('preserves an unknown top-level key and an unmanaged event untouched', () => {
    const existing = {
      model: 'gpt-5',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }] },
    };
    const next = mergeNativeHooks(existing, chain) as {
      model: string;
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(next.model).toBe('gpt-5');
    expect(next.hooks.SessionStart[0].hooks[0].command).toBe('echo start');
    expect(next.hooks.PreToolUse[0].hooks[0].command).toBe('node paqad-a');
    expect(next.hooks.Stop[0].hooks[0].command).toBe('node paqad-b');
  });

  it('treats a non-object hooks field as empty', () => {
    const next = mergeNativeHooks({ hooks: 'oops' }, chain) as {
      hooks: Record<string, unknown[]>;
    };
    expect(next.hooks.PreToolUse).toHaveLength(1);
  });

  it('prunes an exact legacy command and a retired basename, then appends once (idempotent)', () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'X',
            hooks: [{ type: 'command', command: '~/.paqad-ai/current/hooks/old.sh' }],
          },
          {
            matcher: 'X',
            hooks: [{ type: 'command', command: 'node "/abs/hooks/rule-script-enforce.mjs"' }],
          },
          { matcher: 'X', hooks: [{ type: 'command', command: 'node paqad-a' }] },
          { matcher: 'X', hooks: [{ type: 'command', command: 'echo keep-me' }] },
        ],
      },
    };
    const next = mergeNativeHooks(existing, chain, new Set(['~/.paqad-ai/current/hooks/old.sh']), [
      'rule-script-enforce.mjs',
    ]) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    const commands = next.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command));
    expect(commands).not.toContain('~/.paqad-ai/current/hooks/old.sh');
    expect(commands.some((c) => c.includes('rule-script-enforce.mjs'))).toBe(false);
    // The user's own hook survives, and paqad's command is present exactly once.
    expect(commands).toContain('echo keep-me');
    expect(commands.filter((c) => c === 'node paqad-a')).toHaveLength(1);
  });
});

describe('buildNativeHookConfigFile transform (issue #566)', () => {
  it('applies the post-merge transform and serializes with a trailing newline', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-nhc-'));
    const file = buildNativeHookConfigFile({
      projectRoot: root,
      settingsPath: '.host/hooks.json',
      chain: [{ nativeEvent: 'Stop', command: 'node paqad-b' }],
      transform: (merged) => ({ ...merged, extra: true }),
    });
    expect(file.path).toBe('.host/hooks.json');
    expect(file.autoUpdate).toBe(true);
    expect(file.content.endsWith('\n')).toBe(true);
    const json = JSON.parse(file.content) as { extra?: boolean };
    expect(json.extra).toBe(true);
  });

  it('reads an existing on-disk file and merges into it', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-nhc2-'));
    const full = join(root, '.host/hooks.json');
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(
      full,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } }),
    );
    const file = buildNativeHookConfigFile({
      projectRoot: root,
      settingsPath: '.host/hooks.json',
      chain: [{ nativeEvent: 'Stop', command: hookCommand('verification-completion.mjs', ENV) }],
    });
    expect(file.content).toContain('echo user');
    expect(file.content).toContain('verification-completion.mjs');
  });
});
