import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { shouldStripAiAttribution } from '@/delivery/attribution-config.js';

import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { buildFullHookChain, buildNativeHookConfigFile } from '../shared/native-hook-config.js';
import { PAQAD_RUNTIME_PREFIX } from '../shared/paqad-hooks.js';

import { syncTeamSetup, teamSetupNotes, type TeamSetupReport } from './team-setup.js';

const CLAUDE_SETTINGS_FILE = '.claude/settings.json';

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
    return '.mcp.json';
  }
  protected cacheOutputPath() {
    return '.claude/cache.json';
  }
  protected memoryOutputPath() {
    return '.claude/memory.json';
  }

  protected executedHookConfigFiles(): string[] {
    return ['settings.json'];
  }

  async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [...base, buildClaudeSettings(context.projectRoot)];
  }

  syncTeamSetup(
    projectRoot: string,
    env: NodeJS.ProcessEnv = process.env,
  ): { report: TeamSetupReport; notes: string[] } {
    const report = syncTeamSetup(projectRoot, env);
    return { report, notes: teamSetupNotes(projectRoot, report) };
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

function buildClaudeSettings(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): GeneratedFile {
  return buildNativeHookConfigFile({
    projectRoot,
    settingsPath: CLAUDE_SETTINGS_FILE,
    chain: isRunningUnderPlugin(env) ? [] : buildFullHookChain('claude-code', env),
    pruneExact: LEGACY_HOOK_COMMANDS,
    pruneBasenames: RETIRED_HOOK_FILES,
    transform: (merged) => mergeAttribution(merged, projectRoot),
  });
}

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
    ...Object.fromEntries(
      Object.entries(current).filter(([key]) => !['commit', 'pr', 'sessionUrl'].includes(key)),
    ),
  };
  return next;
}
