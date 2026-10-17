// Build-time generator for the Claude Code plugin's shipped artifacts (issue #616).
//
// The plugin ships three generated things under `runtime/claude-plugin/`:
//   - `hooks.json`   — the live hook chain, rooted at `${CLAUDE_PLUGIN_ROOT}/runtime` (Part 3)
//   - `agents/`      — the six stage agents (Part 1)
// and it keeps `.claude-plugin/plugin.json`'s `version` in sync with `package.json` (Part 1).
//
// This module holds the pure builders so BOTH the build script
// (`scripts/build-plugin-manifest.mjs`, which imports it from dist after tsup) and a golden test
// (which imports it from src and asserts the committed files match) call the one implementation —
// no second renderer (RULE-13). It reuses `buildPluginHookChain` + `mergeNativeHooks` (the one hook
// renderer) and `renderClaudePluginStageAgents` (the one stage-agent template path).

import { mergeNativeHooks } from '@/adapters/shared/native-hook-config.js';
import { buildPluginHookChain } from '@/adapters/shared/paqad-hooks.js';
import { renderClaudePluginStageAgents } from '@/stage-isolation/agent-writer.js';

/** The plugin's `hooks.json` object — the plugin hook chain merged into the host hooks shape. */
export function buildPluginHooksConfig(): Record<string, unknown> {
  return mergeNativeHooks({}, buildPluginHookChain());
}

/** `hooks.json` serialized exactly as written to disk (2-space indent, trailing newline). */
export function serializePluginHooksJson(): string {
  return `${JSON.stringify(buildPluginHooksConfig(), null, 2)}\n`;
}

/** The committed plugin manifest, with `version` taken from `package.json` (Part 1). */
export function buildPluginManifest(packageVersion: string): Record<string, unknown> {
  return {
    name: 'paqad',
    displayName: 'paqad',
    description: "Your team's rules, enforced at edit time, with evidence for every change.",
    version: packageVersion,
    hooks: './runtime/claude-plugin/hooks.json',
    agents: './runtime/claude-plugin/agents/',
  };
}

/** `plugin.json` serialized exactly as written to disk (2-space indent, trailing newline). */
export function serializePluginManifest(packageVersion: string): string {
  return `${JSON.stringify(buildPluginManifest(packageVersion), null, 2)}\n`;
}

export { renderClaudePluginStageAgents };
