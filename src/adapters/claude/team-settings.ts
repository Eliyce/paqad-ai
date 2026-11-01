import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'pathe';

import { resolveTeamBootstrapEnabled } from '@/core/framework-config.js';
import { isGitTracked } from '@/core/fs/git-tracked.js';
import { PLUGIN_ID } from '@/health/plugin-install.js';
import { PLUGIN_MARKETPLACE_KEY, pluginSettingsKeys } from '@/install/plugin-settings-keys.js';

import type { GeneratedFile } from '../adapter.interface.js';
import { mergeNativeHooks } from '../shared/native-hook-config.js';
import {
  buildHostHookChain,
  frameworkHomeAbsolute,
  type RenderedHook,
} from '../shared/paqad-hooks.js';

export const CLAUDE_SETTINGS_FILE = '.claude/settings.json';
export const CLAUDE_LOCAL_SETTINGS_FILE = '.claude/settings.local.json';
export const TEAM_LAUNCHER_MARK = '/.paqad/hook.mjs';
export const TEAM_LAUNCHER_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs"';
export const SESSION_START_TIMEOUT_SEC = 600;

const TEAM_KEYS = new Set(['$schema', 'attribution']);

type Json = Record<string, unknown>;

interface HookEntry {
  command?: unknown;
  [key: string]: unknown;
}

interface HookGroup {
  hooks?: HookEntry[];
  [key: string]: unknown;
}

export interface ClaudeSettingsOptions {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  npmChain: RenderedHook[];
  pruneExact: ReadonlySet<string>;
  pruneBasenames: readonly string[];
  transform: (settings: Json) => Json;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isTeamLauncherCommand(command: unknown): boolean {
  return typeof command === 'string' && slash(command).includes(TEAM_LAUNCHER_MARK);
}

export function toLauncherCommand(command: string): string {
  const match = /^node "[^"]*\/hooks\/([^"/]+\.mjs)"(.*)$/.exec(slash(command));
  if (!match) {
    throw new Error(`the paqad hook command has an unexpected shape: ${command}`);
  }
  return `${TEAM_LAUNCHER_COMMAND} ${match[1]}${match[2]}`;
}

export function buildTeamHookChain(env: NodeJS.ProcessEnv = process.env): RenderedHook[] {
  return buildHostHookChain('claude-code', env).map((hook) => ({
    ...hook,
    command: toLauncherCommand(hook.command),
    ...(hook.nativeEvent === 'SessionStart' ? { timeout: SESSION_START_TIMEOUT_SEC } : {}),
  }));
}

export function isMachinePaqadCommand(command: unknown, env: NodeJS.ProcessEnv): boolean {
  if (typeof command !== 'string' || isTeamLauncherCommand(command)) return false;
  const normal = slash(command);
  return (
    normal.includes('/.paqad-ai/') ||
    normal.includes('~/.paqad-ai') ||
    normal.includes(`${frameworkHomeAbsolute(env)}/hooks/`)
  );
}

const HOME_PATH =
  /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[^\\/\s"']+/;

export function holdsHomePath(value: unknown): boolean {
  const text = JSON.stringify(value) ?? '';
  const home = homedir();
  return HOME_PATH.test(text) || (home.length > 1 && slash(text).includes(slash(home)));
}

function readJson(path: string): Json | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function filterHooks(hooks: unknown, keep: (hook: HookEntry) => boolean): Json {
  if (!isRecord(hooks)) return {};
  const out: Json = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = (groups as HookGroup[])
      .filter(isRecord)
      .map((group) => ({
        ...group,
        hooks: (Array.isArray(group.hooks) ? group.hooks : []).filter(
          (hook) => isRecord(hook) && keep(hook),
        ),
      }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

function isPaqadLine(
  hook: HookEntry,
  options: Pick<ClaudeSettingsOptions, 'env' | 'pruneExact' | 'pruneBasenames'>,
): boolean {
  const command = hook.command;
  if (typeof command !== 'string') return false;
  return (
    isTeamLauncherCommand(command) ||
    isMachinePaqadCommand(command, options.env) ||
    options.pruneExact.has(command) ||
    options.pruneBasenames.some((file) => command.includes(file))
  );
}

function withoutPaqadLines(
  settings: Json,
  options: Pick<ClaudeSettingsOptions, 'env' | 'pruneExact' | 'pruneBasenames'>,
): Json {
  if (!('hooks' in settings)) return settings;
  return { ...settings, hooks: filterHooks(settings.hooks, (hook) => !isPaqadLine(hook, options)) };
}

function addTeamKeys(settings: Json): Json {
  const keys = pluginSettingsKeys();
  const marketplaces = isRecord(settings.extraKnownMarketplaces)
    ? settings.extraKnownMarketplaces
    : {};
  const enabled = isRecord(settings.enabledPlugins) ? settings.enabledPlugins : {};
  return {
    ...settings,
    extraKnownMarketplaces: {
      ...marketplaces,
      [PLUGIN_MARKETPLACE_KEY]:
        marketplaces[PLUGIN_MARKETPLACE_KEY] ?? keys.extraKnownMarketplaces[PLUGIN_MARKETPLACE_KEY],
    },
    enabledPlugins: { ...enabled, [PLUGIN_ID]: enabled[PLUGIN_ID] ?? true },
  };
}

function withoutTeamKeys(settings: Json): Json {
  const next: Json = { ...settings };
  for (const [key, inner] of [
    ['extraKnownMarketplaces', PLUGIN_MARKETPLACE_KEY],
    ['enabledPlugins', PLUGIN_ID],
  ] as const) {
    const value = next[key];
    if (!isRecord(value) || !(inner in value)) continue;
    const rest = Object.fromEntries(Object.entries(value).filter(([name]) => name !== inner));
    if (Object.keys(rest).length === 0) delete next[key];
    else next[key] = rest;
  }
  return next;
}

function splitPersonal(existing: Json): { team: Json; personal: Json } {
  const team: Json = {};
  const personal: Json = {};
  for (const [key, value] of Object.entries(existing)) {
    if (key === 'hooks') {
      const hooks = filterHooks(value, () => true);
      if (Object.keys(hooks).length > 0) personal.hooks = hooks;
    } else if (key === 'extraKnownMarketplaces' || key === 'enabledPlugins') {
      const inner = key === 'extraKnownMarketplaces' ? PLUGIN_MARKETPLACE_KEY : PLUGIN_ID;
      const rest = isRecord(value)
        ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== inner))
        : {};
      if (Object.keys(rest).length > 0) personal[key] = rest;
    } else if (TEAM_KEYS.has(key) && !holdsHomePath(value)) {
      team[key] = value;
    } else {
      personal[key] = value;
    }
  }
  return { team, personal };
}

function mergeKeepingExisting(base: unknown, extra: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(extra)) {
    const seen = new Set(base.map((item) => JSON.stringify(item)));
    return [...base, ...extra.filter((item) => !seen.has(JSON.stringify(item)))];
  }
  if (isRecord(base) && isRecord(extra)) {
    const out: Json = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      out[key] = key in base ? mergeKeepingExisting(base[key], value) : value;
    }
    return out;
  }
  return base;
}

function serialize(settings: Json): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function fileFor(path: string, settings: Json): GeneratedFile {
  return { path, content: serialize(settings), autoUpdate: true };
}

export interface ClaudeSettingsPlan {
  files: GeneratedFile[];
  enabled: boolean;
  tracked: boolean;
}

export function planClaudeSettings(options: ClaudeSettingsOptions): ClaudeSettingsPlan {
  const { projectRoot, env, transform } = options;
  const enabled = resolveTeamBootstrapEnabled(projectRoot, env);
  const tracked = isGitTracked(projectRoot, CLAUDE_SETTINGS_FILE);
  const existing = readJson(join(projectRoot, CLAUDE_SETTINGS_FILE)) ?? {};
  const existingLocal = readJson(join(projectRoot, CLAUDE_LOCAL_SETTINGS_FILE));
  const files: GeneratedFile[] = [];

  if (!enabled) {
    const shared = withoutTeamKeys(withoutPaqadLines(existing, options));
    files.push(fileFor(CLAUDE_SETTINGS_FILE, transform(shared)));
    const local = mergeNativeHooks(
      withoutPaqadLines(existingLocal ?? {}, options),
      options.npmChain,
    );
    const localChanged =
      existingLocal === null
        ? options.npmChain.length > 0
        : serialize(local) !== serialize(existingLocal);
    if (localChanged) files.push(fileFor(CLAUDE_LOCAL_SETTINGS_FILE, local));
    return { files, enabled, tracked };
  }

  const chain = buildTeamHookChain(env);
  let shared: Json;
  let personal: Json = {};
  if (tracked) {
    shared = transform(
      addTeamKeys(mergeNativeHooks(withoutPaqadLines(existing, options), chain)),
    );
  } else {
    const split = splitPersonal(withoutPaqadLines(existing, options));
    personal = split.personal;
    shared = transform({ ...addTeamKeys(mergeNativeHooks({}, chain)), ...split.team });
  }
  files.push(fileFor(CLAUDE_SETTINGS_FILE, shared));

  const cleanedLocal = withoutPaqadLines(existingLocal ?? {}, options);
  const local = mergeKeepingExisting(cleanedLocal, personal) as Json;
  const localChanged =
    Object.keys(personal).length > 0 ||
    (existingLocal !== null && serialize(local) !== serialize(existingLocal));
  if (localChanged) files.push(fileFor(CLAUDE_LOCAL_SETTINGS_FILE, local));
  return { files, enabled, tracked };
}
