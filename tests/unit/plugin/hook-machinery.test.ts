import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// Issue #616, Part 3 — the Claude Code plugin renders the live hook chain against
// `${CLAUDE_PLUGIN_ROOT}/runtime`, prepends its own SessionStart bootstrap, drops silent-update,
// and fails OPEN (no onFailure). Part 1 — the plugin ships the six stage agents and a manifest.

describe('buildPluginHookChain (issue #616, Part 3)', () => {
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
    expect(sessionStart[0].command).toBe(`node "${PLUGIN_RUNTIME_ROOT}/hooks/${PLUGIN_SESSION_START_HOOK}"`);
    expect(sessionStart.length).toBeGreaterThan(1);
  });

  it('leaves out silent-update.mjs (the plugin channel updates the plugin)', () => {
    expect(chain.some((h) => h.command.includes('silent-update'))).toBe(false);
  });

  it('fails open — no onFailure or timeout on any entry', () => {
    for (const hook of chain) {
      expect(hook.onFailure).toBeUndefined();
      expect(hook.timeout).toBeUndefined();
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
});

describe('plugin manifest-build generators (issue #616)', () => {
  it('wraps the chain in the host hooks.json shape with a trailing newline', () => {
    const serialized = serializePluginHooksJson();
    expect(serialized.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual(buildPluginHooksConfig());
    expect(Object.keys(parsed.hooks)).toContain('PreToolUse');
  });

  it('builds a manifest whose version comes from package.json', () => {
    const manifest = buildPluginManifest('9.9.9');
    expect(manifest.name).toBe('paqad');
    expect(manifest.version).toBe('9.9.9');
    expect(manifest.hooks).toBe('./runtime/claude-plugin/hooks.json');
    expect(manifest.agents).toBe('./runtime/claude-plugin/agents/');
  });

  it('renders the six Claude stage agents from the shared template', () => {
    const agents = renderClaudePluginStageAgents();
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual([
      'paqad-checks.md',
      'paqad-development.md',
      'paqad-documentation-sync.md',
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

    it('writes the six stage-agent files into the destination dir', () => {
      const written = writeClaudePluginStageAgents(dir);
      expect(written).toHaveLength(6);
      expect(readdirSync(dir).sort()).toEqual([
        'paqad-checks.md',
        'paqad-development.md',
        'paqad-documentation-sync.md',
        'paqad-planning.md',
        'paqad-review.md',
        'paqad-specification.md',
      ]);
    });
  });
});
