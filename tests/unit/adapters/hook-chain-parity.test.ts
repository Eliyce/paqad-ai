import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TEAM_LAUNCHER_COMMAND, buildTeamHookChain } from '@/adapters/claude/team-settings.js';
import {
  PLUGIN_RUNTIME_ROOT,
  PLUGIN_SESSION_START_HOOK,
  buildHostHookChain,
  buildPluginHookChain,
  type RenderedHook,
} from '@/adapters/shared/paqad-hooks.js';

const HOME = '/pinned/home';
const env = { PAQAD_FRAMEWORK_HOME: HOME };

interface Comparable {
  nativeEvent: string;
  matcher: string | undefined;
  script: string;
  onFailure: 'block' | undefined;
  timeout: number | undefined;
}

function comparable(line: RenderedHook, prefix: string): Comparable {
  expect(line.command.includes(prefix)).toBe(true);
  return {
    nativeEvent: line.nativeEvent,
    matcher: line.matcher,
    script: line.command.replace(`${prefix}/hooks/`, ''),
    onFailure: line.onFailure,
    timeout: line.timeout,
  };
}

function hostChain(): Comparable[] {
  return buildHostHookChain('claude-code', env)
    .filter((line) => !line.command.includes('silent-update.mjs'))
    .map((line) => comparable(line, HOME));
}

function teamChain(): Comparable[] {
  return buildTeamHookChain(env)
    .filter((line) => !line.command.includes('silent-update.mjs'))
    .map((line) => ({
      nativeEvent: line.nativeEvent,
      matcher: line.matcher,
      script: line.command.replace(`${TEAM_LAUNCHER_COMMAND} `, ''),
      onFailure: line.onFailure,
      timeout: line.timeout,
    }));
}

function normalized(chain: Comparable[]): Comparable[] {
  return chain.map((line) => ({
    ...line,
    script: line.script.replace(/^node "?/u, '').replace(/"/gu, ''),
    timeout: line.script.includes('agent-entry-session-start') ? undefined : line.timeout,
  }));
}

function pluginChain(): Comparable[] {
  return buildPluginHookChain(env)
    .filter((line) => !line.command.includes(PLUGIN_SESSION_START_HOOK))
    .map((line) => comparable(line, PLUGIN_RUNTIME_ROOT));
}

describe('the plugin route and the npm route render the same hooks', () => {
  it('AC-62: has the same events, matchers, scripts and failure policy on all three chains, apart from the prefix', () => {
    expect(pluginChain()).toEqual(hostChain());
    expect(normalized(teamChain())).toEqual(normalized(hostChain()));
  });

  it('AC-61: the rendered plugin hooks.json blocks on failure with a 10 second limit on the three gates', () => {
    const file = JSON.parse(
      readFileSync(join(process.cwd(), 'runtime/claude-plugin/hooks.json'), 'utf8'),
    ) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> };
    const entries = Object.values(file.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks),
    );
    const blocking = entries.filter((hook) => hook.onFailure === 'block');
    expect(blocking).toHaveLength(3);
    for (const name of ['agent-entry-gate', 'decision-pause-gate', 'capability-gate']) {
      expect(blocking.filter((hook) => String(hook.command).includes(name))).toHaveLength(1);
    }
    for (const hook of blocking) expect(hook.timeout).toBe(10);
  });

  it('AC-7, AC-11, AC-61 and AC-62: blocks on failure on the three gates and leaves the handback hook fail-open', () => {
    for (const chain of [hostChain(), pluginChain()]) {
      const blocking = chain.filter((line) => line.onFailure === 'block');
      expect(blocking.map((line) => line.script.split('"').join(''))).toEqual([
        'node agent-entry-gate.mjs',
        'node decision-pause-gate.mjs',
        'node capability-gate.mjs pre-mutation',
      ]);
      for (const line of blocking) expect(line.timeout).toBe(10);
      const handback = chain.find((line) => line.matcher === 'SubagentHandback')!;
      expect(handback.onFailure).toBeUndefined();
      expect(handback.timeout).toBe(10);
    }
  });

  it('renders the handback hook on Claude Code only', () => {
    expect(
      buildHostHookChain('codex-cli', env).some((line) =>
        line.command.includes('stage-agent-handback.mjs'),
      ),
    ).toBe(false);
  });
});
