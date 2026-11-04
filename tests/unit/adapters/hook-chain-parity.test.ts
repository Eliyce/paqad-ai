import { describe, expect, it } from 'vitest';

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

function pluginChain(): Comparable[] {
  return buildPluginHookChain(env)
    .filter((line) => !line.command.includes(PLUGIN_SESSION_START_HOOK))
    .map((line) => comparable(line, PLUGIN_RUNTIME_ROOT));
}

describe('the plugin route and the npm route render the same hooks', () => {
  it('has the same events, matchers, scripts and failure policy, apart from the prefix', () => {
    expect(pluginChain()).toEqual(hostChain());
  });

  it('blocks on failure on the three gates and leaves the handback hook fail-open', () => {
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
