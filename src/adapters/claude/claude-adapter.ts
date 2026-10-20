import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { shouldStripAiAttribution } from '@/delivery/attribution-config.js';

import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildFullHookChain, buildNativeHookConfigFile } from '../shared/native-hook-config.js';
import { PAQAD_RUNTIME_PREFIX } from '../shared/paqad-hooks.js';

const CLAUDE_SETTINGS_FILE = '.claude/settings.json';

// Hook commands paqad used to generate but no longer does: the POSIX-only `.sh`
// gates, and the bare-path `.mjs` invocations that relied on a shebang/exec-bit
// (both Windows-broken, issue #240). Pruned from an existing settings.json on
// re-onboard so a retired command never lingers beside its `node "<abs>"`
// replacement — a clean cutover with no migration step.
const LEGACY_HOOK_COMMANDS = new Set(
  [
    'agent-entry-gate.sh',
    'agent-entry-prompt-gate.sh',
    'agent-entry-session-start.sh',
    'decision-pause-gate.sh',
    'silent-update.sh',
    'silent-update.mjs',
    'rule-script-enforce.mjs',
    'verification-completion.mjs',
    'verification-record.mjs',
  ].map((file) => `${PAQAD_RUNTIME_PREFIX}/hooks/${file}`),
);

// Hook FILES paqad has fully retired (the capability-kernel replacement, F3).
// Unlike LEGACY_HOOK_COMMANDS — which prunes the bare `~` #240 forms of hooks
// that still ship under a `node "<abs>"` command — these have NO replacement
// command, so an existing config may carry the retired hook in its absolute
// `node "<abs>/hooks/<file>"` form. Pruned by basename so re-onboard removes it in
// EITHER form and the replacement (capability-gate.mjs) never double-fires beside
// it. rule-script-enforce.mjs is now subsumed by capability-gate.mjs.
const RETIRED_HOOK_FILES = ['rule-script-enforce.mjs'];

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly type = 'claude-code' as const;

  protected configTemplateName() {
    return 'claude.md.hbs';
  }
  protected configOutputPath() {
    return 'CLAUDE.md';
  }
  protected skillsRoot() {
    return '.claude/skills';
  }
  protected agentsRoot() {
    return '.claude/agents';
  }
  protected hooksOutputPath() {
    return '.claude/settings.hooks.json';
  }
  protected mcpOutputPath() {
    // The project MCP file Claude Code really reads. paqad only reads it (doctor, issue #622).
    return '.mcp.json';
  }
  protected cacheOutputPath() {
    return '.claude/cache.json';
  }
  protected memoryOutputPath() {
    return '.claude/memory.json';
  }

  // `.claude/settings.json` is the file Claude executes hooks from; it now carries
  // the absolute, machine-specific `node "<abs>"` command, so it is per-machine.
  protected executedHookConfigFiles(): string[] {
    return ['settings.json'];
  }

  async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [...base, buildClaudeSettings(context.projectRoot)];
  }
}

const PLUGIN_PATH_MARKERS = ['/plugins/cache/', '/plugins/data/'];

export function isUnderPluginPath(path: string | undefined): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  const posix = path.replace(/\\/g, '/');
  return PLUGIN_PATH_MARKERS.some((marker) => posix.includes(marker));
}

export interface PluginRunSignals {
  runtimeRoot?: string;
  cliEntry?: string;
}

export function isRunningUnderPlugin(
  env: NodeJS.ProcessEnv,
  signals: PluginRunSignals = { runtimeRoot: getRuntimeRoot(), cliEntry: process.argv[1] },
): boolean {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (typeof pluginRoot === 'string' && pluginRoot.length > 0) {
    return true;
  }
  return isUnderPluginPath(signals.runtimeRoot) || isUnderPluginPath(signals.cliEntry);
}

// Render the full #117/#566 live hook chain into Claude's settings.json shape via
// the one shared renderer, then fold in the attribution block. `mergeAgentEntryGate`
// and its per-event merge/prune helpers were retired here — that logic now lives in
// `native-hook-config.ts`, the single renderer both hook-capable hosts share.
function buildClaudeSettings(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): GeneratedFile {
  return buildNativeHookConfigFile({
    projectRoot,
    settingsPath: CLAUDE_SETTINGS_FILE,
    // Issue #567 — the SubagentStop hook renders unconditionally; stage isolation is
    // core-engine behavior with no config knob.
    // Issue #641 (Gap 2) — when onboarding runs under the plugin, the plugin already supplies
    // the full chain, so emit NO npm chain here (an empty chain); the legacy prune and the
    // attribution transform still run. This keeps exactly one hook chain per plugin-onboarded
    // repo. Onboarding from npm (no CLAUDE_PLUGIN_ROOT) writes the chain exactly as before.
    chain: isRunningUnderPlugin(env) ? [] : buildFullHookChain('claude-code', env),
    pruneExact: LEGACY_HOOK_COMMANDS,
    pruneBasenames: RETIRED_HOOK_FILES,
    transform: (merged) => mergeAttribution(merged, projectRoot),
  });
}

/**
 * Suppress Claude Code's own commit/PR attribution when the project's `ai_attribution` policy
 * says `strip` (issue #538). Claude Code appends a `Co-Authored-By: Claude` trailer to commits
 * and an attribution line to PR bodies by default, and that trailer is what makes a git host
 * list the AI vendor as a CONTRIBUTOR — the thing an enterprise buyer rejects.
 *
 * Writes the CURRENT `attribution` object, never the deprecated `includeCoAuthoredBy` (INV-5).
 * Each of the three sub-keys is filled in only when absent, so a value the team set by hand
 * survives re-onboard (INV-4) — for example a team that wants its own house trailer rather than
 * no trailer at all.
 */
function mergeAttribution(
  settings: Record<string, unknown>,
  projectRoot: string,
): Record<string, unknown> {
  if (!shouldStripAiAttribution(projectRoot)) {
    return settings;
  }
  const next = { ...settings };
  const current =
    next.attribution && typeof next.attribution === 'object'
      ? (next.attribution as Record<string, unknown>)
      : {};
  next.attribution = {
    commit: current.commit ?? '',
    pr: current.pr ?? '',
    sessionUrl: current.sessionUrl ?? false,
    // Preserve anything Claude Code adds to this object that paqad does not know about.
    ...Object.fromEntries(
      Object.entries(current).filter(([key]) => !['commit', 'pr', 'sessionUrl'].includes(key)),
    ),
  };
  return next;
}
