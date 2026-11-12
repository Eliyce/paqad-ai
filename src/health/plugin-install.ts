import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type FrameworkCopy = 'plugin' | 'npm' | 'directory' | 'unknown';

export interface FrameworkLinkInfo {
  readonly home: string;
  readonly linkTarget: string | null;
  readonly targetExists: boolean;
  readonly copy: FrameworkCopy;
  readonly version: string | null;
}

export function frameworkLinkHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PAQAD_FRAMEWORK_HOME ?? join(homedir(), '.paqad-ai', 'current');
}

export const PLUGIN_ID = 'paqad@eliyce';

export function installedPluginsPath(): string {
  return join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
}

export function isPluginInstalled(path: string = installedPluginsPath()): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return JSON.stringify(parsed).includes(PLUGIN_ID);
  } catch {
    return false;
  }
}

export type PluginLoadState = 'live' | 'absent' | 'unknown';

export interface PluginLoadOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalRoot(path: string): string {
  let full: string;
  try {
    full = realpathSync.native(path);
  } catch {
    full = resolve(path);
  }
  const trimmed = full.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

function entryLoadsHere(entry: unknown, projectRoot: string | null): boolean {
  if (!isRecord(entry)) return false;
  const path = entry.installPath;
  if (typeof path !== 'string' || path.trim() === '' || !existsSync(path)) return false;
  const scope = typeof entry.scope === 'string' ? entry.scope : 'user';
  if (scope !== 'project' && scope !== 'local') return true;
  return (
    projectRoot !== null &&
    typeof entry.projectPath === 'string' &&
    canonicalRoot(entry.projectPath) === canonicalRoot(projectRoot)
  );
}

function pluginSwitchedOn(
  projectRoot: string | null,
  env: NodeJS.ProcessEnv,
  home: string,
): boolean {
  const layers = [join(claudeConfigDir(env, home), 'settings.json')];
  if (projectRoot !== null) {
    layers.push(
      join(projectRoot, '.claude', 'settings.json'),
      join(projectRoot, '.claude', 'settings.local.json'),
    );
  }
  let enabled: boolean | undefined;
  for (const layer of layers) {
    const settings = readJsonFile(layer);
    const map = isRecord(settings) ? settings.enabledPlugins : undefined;
    if (isRecord(map) && typeof map[PLUGIN_ID] === 'boolean') enabled = map[PLUGIN_ID];
  }
  return enabled !== false;
}

function projectPluginSwitch(projectRoot: string, file: string): boolean | undefined {
  const settings = readJsonFile(join(projectRoot, '.claude', file));
  const map = isRecord(settings) ? settings.enabledPlugins : undefined;
  return isRecord(map) && typeof map[PLUGIN_ID] === 'boolean' ? map[PLUGIN_ID] : undefined;
}

export function projectTurnsPluginOn(projectRoot: string): boolean {
  return projectPluginSwitch(projectRoot, 'settings.json') === true;
}

export function pluginOptedOutLocally(projectRoot: string): boolean {
  return projectPluginSwitch(projectRoot, 'settings.local.json') === false;
}

export function pluginLoadState(
  projectRoot: string | null,
  options: PluginLoadOptions = {},
): PluginLoadState {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const parsed = readJsonFile(
    join(claudeConfigDir(env, home), 'plugins', 'installed_plugins.json'),
  );
  if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.plugins)) return 'unknown';
  const value = parsed.plugins[PLUGIN_ID];
  const entries = Array.isArray(value) ? value : [value];
  if (!entries.some((entry) => entryLoadsHere(entry, projectRoot))) return 'absent';
  return pluginSwitchedOn(projectRoot, env, home) ? 'live' : 'absent';
}

export const DISCOVERY_PLUGIN_PREFIX = 'paqad-product-discovery@';

export const DISCOVERY_CLASH_MESSAGE =
  'The paqad discovery plugin is installed next to the paqad plugin. Both are named paqad, so Claude Code may run the hooks of only one, and your stage checks can stop. Remove paqad discovery: the paqad plugin already has discover and ask.';

function childFolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

function syncedPaqadManifests(configDir: string): Record<string, unknown>[] {
  const folders = childFolders(join(configDir, 'plugins', 'synced'));
  return [...folders, ...folders.flatMap(childFolders)]
    .map((folder) => readJsonFile(join(folder, '.claude-plugin', 'plugin.json')))
    .filter(isRecord)
    .filter((manifest) => manifest.name === 'paqad');
}

export function discoveryPluginClash(options: PluginLoadOptions = {}): boolean {
  const env = options.env ?? process.env;
  const configDir = claudeConfigDir(env, options.home ?? homedir());
  const installed = readJsonFile(join(configDir, 'plugins', 'installed_plugins.json'));
  const keys =
    isRecord(installed) && isRecord(installed.plugins) ? Object.keys(installed.plugins) : [];
  const synced = syncedPaqadManifests(configDir);
  const discovery =
    keys.some((key) => key.startsWith(DISCOVERY_PLUGIN_PREFIX)) ||
    synced.some((manifest) => manifest.hooks === undefined);
  const engineering =
    keys.includes(PLUGIN_ID) || synced.some((manifest) => manifest.hooks !== undefined);
  return discovery && engineering;
}

export function readPackageVersion(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export function readRuntimeCopyVersion(copyRoot: string): string | null {
  try {
    const version = readFileSync(join(copyRoot, 'version'), 'utf8').trim();
    return version === '' ? null : version;
  } catch {
    return null;
  }
}

function readCopyVersion(dir: string): string | null {
  return readPackageVersion(dir) ?? readRuntimeCopyVersion(dir);
}

export function classifyFrameworkCopy(target: string): FrameworkCopy {
  if (target.includes('/plugins/') || target.includes('\\plugins\\')) return 'plugin';
  if (target.includes('node_modules')) return 'npm';
  return 'unknown';
}

export function describeFrameworkLink(env: NodeJS.ProcessEnv = process.env): FrameworkLinkInfo {
  const home = frameworkLinkHome(env);
  let linkTarget: string | null;
  try {
    linkTarget = readlinkSync(home);
  } catch {
    linkTarget = null;
  }

  if (linkTarget === null) {
    const isDir = existsSync(home);
    return {
      home,
      linkTarget: null,
      targetExists: isDir,
      copy: isDir ? 'directory' : 'unknown',
      version: isDir ? readCopyVersion(dirname(home)) : null,
    };
  }

  const targetExists = existsSync(linkTarget);
  return {
    home,
    linkTarget,
    targetExists,
    copy: targetExists ? classifyFrameworkCopy(linkTarget) : 'unknown',
    version: targetExists ? readCopyVersion(dirname(linkTarget)) : null,
  };
}
