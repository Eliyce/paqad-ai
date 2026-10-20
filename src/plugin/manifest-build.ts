// Build-time generator for the Claude Code plugin's shipped artifacts (issue #616).
//
// The plugin ships three generated things under `runtime/claude-plugin/`:
//   - `hooks.json`   — the live hook chain, rooted at `${CLAUDE_PLUGIN_ROOT}/runtime` (Part 3)
//   - `agents/`     : the six stage agents (Part 1) and the two High Table agents (#639 Part 13)
//   - `skills/`      — the onboard / join / dashboard skills (Parts 8 + 8b)
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

/**
 * The paqad HUD mod (issue #639, Part 8), named beside `hooks` as Claude Code's hooks file
 * expects: one module path, relative to `hooks.json`. The mod only shows and asks; every check
 * stays one of the hooks above, so the hook entries are byte-identical with or without it.
 */
export const PLUGIN_MOD_MODULES = ['./mod/register.tsx'] as const;

/** The mod's `$.state` contract, named as `types` in `plugin.json`. */
export const PLUGIN_MOD_TYPES = './runtime/claude-plugin/mod/types/index.d.ts';

/** The plugin's `hooks.json` object — the plugin hook chain merged into the host hooks shape. */
export function buildPluginHooksConfig(): Record<string, unknown> {
  return { ...mergeNativeHooks({}, buildPluginHookChain()), modules: [...PLUGIN_MOD_MODULES] };
}

/** `hooks.json` serialized exactly as written to disk (2-space indent, trailing newline). */
export function serializePluginHooksJson(): string {
  return `${JSON.stringify(buildPluginHooksConfig(), null, 2)}\n`;
}

/**
 * The relative paths of the plugin's bundled agent files: the stage agents in stage order, then the
 * two High Table agents (issue #639, Part 13). Claude Code's plugin
 * schema wants `agents` as an array of individual `.md` file paths, not a directory (verified
 * against `claude plugin validate`), so this derives the list from the same stage-agent set the
 * files are generated from.
 */
export function pluginAgentPaths(): string[] {
  return renderClaudePluginStageAgents().map(
    (agent) => `./runtime/claude-plugin/agents/${agent.name}`,
  );
}

/**
 * The committed plugin manifest, with `version` taken from `package.json` (Part 1). The shape is
 * what the installed Claude Code schema accepts: no `displayName` (an unrecognized key), `agents` as
 * an array of file paths, and `author` for attribution.
 */
export function buildPluginManifest(packageVersion: string): Record<string, unknown> {
  return {
    name: 'paqad',
    description: "Your team's rules, enforced at edit time, with evidence for every change.",
    version: packageVersion,
    author: { name: 'Eliyce' },
    hooks: './runtime/claude-plugin/hooks.json',
    agents: pluginAgentPaths(),
    skills: './runtime/claude-plugin/skills',
    types: PLUGIN_MOD_TYPES,
  };
}

/** `plugin.json` serialized exactly as written to disk (2-space indent, trailing newline). */
export function serializePluginManifest(packageVersion: string): string {
  return `${JSON.stringify(buildPluginManifest(packageVersion), null, 2)}\n`;
}

export { renderClaudePluginStageAgents };
