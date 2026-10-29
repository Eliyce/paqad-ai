import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  PLUGIN_RUNTIME_ROOT,
  PLUGIN_SESSION_START_HOOK,
  buildPluginHookChain,
  buildHostHookChain,
} from '@/adapters/shared/paqad-hooks.js';
import {
  buildPluginHooksConfig,
  buildPluginManifest,
  renderClaudePluginStageAgents,
  serializePluginHooksJson,
} from '@/plugin/manifest-build.js';
import { writeClaudePluginStageAgents } from '@/stage-isolation/agent-writer.js';
import { mergeNativeHooks } from '@/adapters/shared/native-hook-config.js';

const PLUGIN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'runtime',
  'claude-plugin',
);

describe('buildPluginHookChain', () => {
  const chain = buildPluginHookChain();

  it('roots every command at ${CLAUDE_PLUGIN_ROOT}/runtime/hooks', () => {
    expect(chain.length).toBeGreaterThan(0);
    for (const hook of chain) {
      expect(hook.command).toContain(`${PLUGIN_RUNTIME_ROOT}/hooks/`);
      expect(hook.command).not.toContain('.paqad-ai/current');
    }
  });

  it('prepends the plugin-only SessionStart bootstrap before the other session hooks', () => {
    const sessionStart = chain.filter((h) => h.nativeEvent === 'SessionStart');
    expect(sessionStart[0].command).toBe(
      `node "${PLUGIN_RUNTIME_ROOT}/hooks/${PLUGIN_SESSION_START_HOOK}"`,
    );
    expect(sessionStart.length).toBeGreaterThan(1);
  });

  it('leaves out silent-update.mjs (the plugin channel updates the plugin)', () => {
    expect(chain.some((h) => h.command.includes('silent-update'))).toBe(false);
  });

  it('fails open — no onFailure on any entry, and only the stage seed hook carries a timeout', () => {
    for (const hook of chain) {
      expect(hook.onFailure).toBeUndefined();
      if (hook.nativeEvent === 'SubagentStart') {
        expect(hook.timeout).toBe(10);
      } else {
        expect(hook.timeout).toBeUndefined();
      }
    }
  });

  it('carries the SubagentStop matcher that accepts the paqad: plugin namespace', () => {
    const subagent = chain.find((h) => h.nativeEvent === 'SubagentStop');
    expect(subagent?.matcher).toBe('^(paqad:)?paqad-');
  });

  it('covers the same native events as the onboard-time claude-code chain', () => {
    const pluginEvents = new Set(chain.map((h) => h.nativeEvent));
    const onboardEvents = new Set(buildHostHookChain('claude-code').map((h) => h.nativeEvent));
    expect([...pluginEvents].sort()).toEqual([...onboardEvents].sort());
  });

  it('wires every shipped plugin hook file under the same event in the onboard-time chain', () => {
    const hookFile = (command: string) => /hooks\/([\w-]+\.mjs)/.exec(command)?.[1] ?? command;
    const pairs = (hooks: { nativeEvent: string; command: string }[]) =>
      hooks.map((h) => `${h.nativeEvent} ${hookFile(h.command)}`);
    const onboard = new Set(pairs(buildHostHookChain('claude-code')));
    const shipped = pairs(
      Object.entries(
        (
          JSON.parse(readFileSync(join(PLUGIN_DIR, 'hooks.json'), 'utf8')) as {
            hooks: Record<string, { hooks: { command: string }[] }[]>;
          }
        ).hooks,
      ).flatMap(([nativeEvent, groups]) =>
        groups.flatMap((group) => group.hooks.map((h) => ({ nativeEvent, command: h.command }))),
      ),
    ).filter((pair) => !pair.endsWith(PLUGIN_SESSION_START_HOOK));

    expect(shipped).toContain('SubagentStart stage-agent-start.mjs');
    expect(shipped.filter((pair) => !onboard.has(pair))).toEqual([]);
  });
});

describe('plugin manifest-build generators', () => {
  it('wraps the chain in the host hooks.json shape with a trailing newline', () => {
    const serialized = serializePluginHooksJson();
    expect(serialized.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual(buildPluginHooksConfig());
    expect(Object.keys(parsed.hooks)).toContain('PreToolUse');
  });

  it('names the HUD mod beside the hooks and leaves every hook entry as it was', () => {
    const config = buildPluginHooksConfig();
    expect(Object.keys(config)).toEqual(['hooks', 'modules']);
    expect(config.modules).toEqual(['./mod/register.tsx']);
    const hooksOnly = { ...config };
    delete hooksOnly.modules;
    const before = mergeNativeHooks({}, buildPluginHookChain());
    expect(hooksOnly).toEqual(before);
    const beforeText = `${JSON.stringify(before, null, 2)}\n`;
    expect(serializePluginHooksJson().startsWith(beforeText.slice(0, -'\n}\n'.length))).toBe(true);
    expect(existsSync(join(PLUGIN_DIR, 'mod', 'register.tsx'))).toBe(true);
  });

  it('builds a manifest whose version comes from package.json, in the schema Claude Code accepts', () => {
    const manifest = buildPluginManifest('9.9.9');
    expect(manifest.name).toBe('paqad');
    expect(manifest.version).toBe('9.9.9');
    expect(manifest.hooks).toBe('./runtime/claude-plugin/hooks.json');
    expect(Array.isArray(manifest.agents)).toBe(true);
    expect(manifest.agents).toHaveLength(8);
    expect(manifest.agents).toContain('./runtime/claude-plugin/agents/paqad-development.md');
    expect(manifest.agents).toContain('./runtime/claude-plugin/agents/paqad-expert.md');
    expect(manifest.agents).toContain('./runtime/claude-plugin/agents/paqad-chief-architect.md');
    expect(manifest.displayName).toBe('paqad');
    expect(manifest.author).toEqual({
      name: 'Eliyce',
      email: 'hello@eliyce.com',
      url: 'https://eliyce.com',
    });
  });

  it('renders the six Claude stage agents and the two High Table agents from the shared template', () => {
    const agents = renderClaudePluginStageAgents();
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual([
      'paqad-checks.md',
      'paqad-chief-architect.md',
      'paqad-development.md',
      'paqad-documentation-sync.md',
      'paqad-expert.md',
      'paqad-planning.md',
      'paqad-review.md',
      'paqad-specification.md',
    ]);
    for (const agent of agents) {
      expect(agent.content).toContain('name:');
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });

  describe('writeClaudePluginStageAgents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-plugin-agents-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('writes the six stage-agent files and the two High Table agents into the destination dir', () => {
      const written = writeClaudePluginStageAgents(dir);
      expect(written).toHaveLength(8);
      expect(readdirSync(dir).sort()).toEqual([
        'paqad-checks.md',
        'paqad-chief-architect.md',
        'paqad-development.md',
        'paqad-documentation-sync.md',
        'paqad-expert.md',
        'paqad-planning.md',
        'paqad-review.md',
        'paqad-specification.md',
      ]);
    });
  });
});
