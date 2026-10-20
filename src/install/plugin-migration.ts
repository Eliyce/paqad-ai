import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { resolvePluginMigrationConfig, setConfigValue } from '@/core/framework-config.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import { versionAtLeast } from '@/core/version-compare.js';
import { VERSION } from '@/index.js';

import {
  classifyFrameworkCopy,
  PLUGIN_ID,
  readPackageVersion,
  readRuntimeCopyVersion,
} from '../health/plugin-install.js';

export const PLUGIN_MARKETPLACE_REPO = 'Eliyce/paqad-ai';
const MARKETPLACE_KEY = 'eliyce';

const MARKETPLACE_ADD_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const UNINSTALL_TIMEOUT_MS = 120_000;

export const MIN_CLAUDE_VERSION = '2.1.295';

export type MigrationState =
  'pending' | 'installed' | 'done' | 'failed' | 'rolled-back' | 'declined' | 'skipped';

export type MigrationPath = 'cli' | 'bundled-cli' | 'settings' | 'synced';

export interface MigrationRecord {
  state: MigrationState;
  path?: MigrationPath;
  reason?: string;
  attempts: number;
  last_attempt_at?: string;
  version: string;
  npm_sessions_since_install?: number;
  installed_at?: string;
  counted_sessions?: string[];
  last_real_attempt_at?: string;
  last_real_reason?: string;
}

export interface MigrationDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => Date;
  version?: string;
  claudeVersion?: () => string | null;
  runClaudeInstall?: ClaudeInstallRunner;
  bundledClaude?: () => string | null;
  runClaudeUninstall?: (home: string) => void;
  managedSettingsPaths?: string[];
  log?: (message: string) => void;
}

export interface MigrationResult {
  state: MigrationState;
  path?: MigrationPath;
  reason?: string;
}

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MANAGED_POLICY_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ROLLBACK_AFTER_NPM_SESSIONS = 3;
const INSTALL_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COUNTED_SESSIONS = 10;

function paqadHome(home: string): string {
  return join(home, '.paqad-ai');
}
export function migrationStatePath(home: string): string {
  return join(paqadHome(home), 'plugin-migration.json');
}
export function migrationLockDir(home: string): string {
  return join(paqadHome(home), 'locks', 'plugin-migration.lock');
}
export function pluginSeenPath(home: string): string {
  return join(paqadHome(home), 'plugin-seen.json');
}
export function migrationLogPath(home: string): string {
  return join(paqadHome(home), 'logs', 'plugin-migration.log');
}
function userClaudeSettingsPath(home: string): string {
  return join(home, '.claude', 'settings.json');
}

export function readMigrationState(home: string): MigrationRecord | null {
  try {
    return JSON.parse(readFileSync(migrationStatePath(home), 'utf8')) as MigrationRecord;
  } catch {
    return null;
  }
}

export function writeMigrationState(home: string, record: MigrationRecord): void {
  const path = migrationStatePath(home);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(tmp, path);
  } catch {}
}

export function readPluginSeen(
  home: string,
): { version?: string; at?: string; root?: string } | null {
  try {
    return JSON.parse(readFileSync(pluginSeenPath(home), 'utf8')) as {
      version?: string;
      at?: string;
      root?: string;
    };
  } catch {
    return null;
  }
}

function clearPluginSeen(home: string): void {
  try {
    rmSync(pluginSeenPath(home), { force: true });
  } catch {}
}

export function isSyncedRoot(root: string | undefined): boolean {
  if (typeof root !== 'string') return false;
  const path = root.replaceAll('\\', '/');
  if (path.includes('/plugins/synced/')) return true;
  const sessions = path.indexOf('/Claude/local-agent-mode-sessions/');
  return sessions !== -1 && path.indexOf('/rpm/plugin_', sessions) !== -1;
}

export function isPluginPresent(home: string): boolean {
  return isPluginInstalledRecord(home) || readPluginSeen(home) !== null;
}

function isPluginInstalledRecord(home: string): boolean {
  const installed = join(home, '.claude', 'plugins', 'installed_plugins.json');
  try {
    return JSON.stringify(JSON.parse(readFileSync(installed, 'utf8'))).includes(PLUGIN_ID);
  } catch {
    return false;
  }
}

function userDisabledPlugin(home: string): boolean {
  try {
    const settings = JSON.parse(readFileSync(userClaudeSettingsPath(home), 'utf8')) as {
      enabledPlugins?: Record<string, unknown>;
    };
    return settings.enabledPlugins?.[PLUGIN_ID] === false;
  } catch {
    return false;
  }
}

function doneButDisabled(record: MigrationRecord | null, home: string): boolean {
  return record?.state === 'done' && userDisabledPlugin(home);
}

const USER_DISABLED_REASON = 'user-disabled';

function isCiOrHeadless(env: NodeJS.ProcessEnv): boolean {
  return (
    (typeof env.CI === 'string' && env.CI !== '') ||
    (typeof env.PAQAD_HEADLESS === 'string' && env.PAQAD_HEADLESS !== '') ||
    env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli'
  );
}

export function projectTargetsClaudeCode(projectRoot: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), 'utf8'),
    ) as OnboardingManifest;
    if (manifest.adapter === 'claude-code') return true;
    return (manifest.generated_artifacts ?? []).some(
      (artifact) => artifact.path.replaceAll('\\', '/') === 'CLAUDE.md',
    );
  } catch {
    return false;
  }
}

export function defaultManagedSettingsPaths(
  platform: NodeJS.Platform = process.platform,
): string[] {
  const base =
    platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode'
      : platform === 'win32'
        ? 'C:\\Program Files\\ClaudeCode'
        : '/etc/claude-code';
  const dir = join(base, 'managed-settings.d');
  const files = [join(base, 'managed-settings.json')];
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) files.push(join(dir, name));
    }
  } catch {}
  return files;
}

export type ManagedPolicyBlock = 'hooks-blocked' | 'plugin-blocked';

export function classifyManagedPolicy(paths: string[]): ManagedPolicyBlock | null {
  let found: ManagedPolicyBlock | null = null;
  for (const path of paths) {
    const policy = readPolicyFile(path);
    if (!policy) continue;
    if (policy.allowManagedHooksOnly === true || policy.disableAllHooks === true) {
      return 'hooks-blocked';
    }
    if (policyBlocksPlugin(policy)) found = 'plugin-blocked';
  }
  return found;
}

function readPolicyFile(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function policyBlocksPlugin(policy: Record<string, unknown>): boolean {
  const enabled = policy.enabledPlugins;
  if (isRecord(enabled) && enabled[PLUGIN_ID] === false) return true;
  const strict = policy.strictKnownMarketplaces;
  if (Array.isArray(strict) && !marketplaceReferenced(strict)) return true;
  const blocked = policy.blockedMarketplaces;
  return Array.isArray(blocked) && marketplaceReferenced(blocked);
}

export function managedPolicyBlockReason(paths: string[]): string | null {
  return classifyManagedPolicy(paths) === null ? null : 'managed-policy';
}

function marketplaceReferenced(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes(PLUGIN_MARKETPLACE_REPO));
}

const CONFIG_SKIP_REASONS: ReadonlySet<string> = new Set([
  'migration-off',
  'install-mode-settings',
  'no-claude-code-provider',
  'ci-or-headless',
]);

const AUTO_ROLLBACK_REASON = 'plugin-never-loaded';

const NEVER_INSTALLED_REASON = 'plugin-never-installed';

const AUTO_ROLLBACK_REASONS = new Set([AUTO_ROLLBACK_REASON, NEVER_INSTALLED_REASON]);

function isSettled(record: MigrationRecord): boolean {
  if (record.state === 'rolled-back') return !AUTO_ROLLBACK_REASONS.has(record.reason ?? '');
  return record.state === 'done' || record.state === 'declined';
}

export function retryAllowed(record: MigrationRecord | null, now: Date): boolean {
  if (!record) return true;
  if (isSettled(record)) return false;
  if (record.attempts >= MAX_ATTEMPTS) return false;
  const configSkip = isConfigSkip(record.state, record.reason);
  const at = configSkip
    ? record.last_real_attempt_at
    : (record.last_real_attempt_at ?? record.last_attempt_at);
  if (!at) return true;
  const reason = configSkip ? record.last_real_reason : record.reason;
  const since = now.getTime() - new Date(at).getTime();
  const window = reason === 'managed-policy' ? MANAGED_POLICY_RECHECK_MS : RETRY_WINDOW_MS;
  return since >= window;
}

function isConfigSkip(state: MigrationState, reason: string | undefined): boolean {
  return state === 'skipped' && CONFIG_SKIP_REASONS.has(reason ?? '');
}

function pluginSettingsKeys(): {
  extraKnownMarketplaces: Record<string, unknown>;
  enabledPlugins: Record<string, boolean>;
} {
  return {
    extraKnownMarketplaces: {
      [MARKETPLACE_KEY]: {
        source: { source: 'github', repo: PLUGIN_MARKETPLACE_REPO },
        autoUpdate: true,
      },
    },
    enabledPlugins: { [PLUGIN_ID]: true },
  };
}

export function installViaSettings(home: string): { state: MigrationState; reason?: string } {
  const path = userClaudeSettingsPath(home);
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return { state: 'failed', reason: 'user-settings-unreadable' };
    }
  }
  const existingEnabled = settings.enabledPlugins as Record<string, unknown> | undefined;
  if (existingEnabled && existingEnabled[PLUGIN_ID] === false) {
    return { state: 'declined', reason: 'user-opted-out' };
  }
  const keys = pluginSettingsKeys();
  const next: Record<string, unknown> = {
    ...settings,
    extraKnownMarketplaces: {
      ...((settings.extraKnownMarketplaces as Record<string, unknown>) ?? {}),
      ...keys.extraKnownMarketplaces,
    },
    enabledPlugins: {
      ...((settings.enabledPlugins as Record<string, unknown>) ?? {}),
      ...keys.enabledPlugins,
    },
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, path);
  } catch {
    return { state: 'failed', reason: 'user-settings-write-failed' };
  }
  return { state: 'installed' };
}

export function undoViaSettings(home: string): void {
  const path = userClaudeSettingsPath(home);
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const marketplaces = settings.extraKnownMarketplaces as Record<string, unknown> | undefined;
  if (marketplaces) delete marketplaces[MARKETPLACE_KEY];
  const enabled = settings.enabledPlugins as Record<string, unknown> | undefined;
  if (enabled) delete enabled[PLUGIN_ID];
  try {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(tmp, path);
  } catch {}
}

export { versionAtLeast };

interface ResolvedDeps {
  env: NodeJS.ProcessEnv;
  home: string;
  now: () => Date;
  version: string;
  claudeVersion: () => string | null;
  runClaudeInstall: ClaudeInstallRunner;
  bundledClaude: () => string | null;
  runClaudeUninstall: (home: string) => void;
  managedSettingsPaths: string[];
  log: (message: string) => void;
}

function resolveDeps(deps: MigrationDeps): ResolvedDeps {
  const home = deps.home ?? homedir();
  return {
    env: deps.env ?? process.env,
    home,
    now: deps.now ?? (() => new Date()),
    version: deps.version ?? VERSION,
    claudeVersion: deps.claudeVersion ?? defaultClaudeVersion,
    runClaudeInstall: deps.runClaudeInstall ?? defaultRunClaudeInstall,
    bundledClaude: deps.bundledClaude ?? (() => findBundledClaude(home)),
    runClaudeUninstall: deps.runClaudeUninstall ?? (() => {}),
    managedSettingsPaths: deps.managedSettingsPaths ?? defaultManagedSettingsPaths(),
    log: deps.log ?? ((message: string) => appendMigrationLog(home, message)),
  };
}

function appendMigrationLog(home: string, message: string): void {
  try {
    const path = migrationLogPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
  } catch {}
}

/* v8 ignore start -- the real `claude --version` probe + detached install are exercised through the
   injected seams; the process-spawning defaults are covered by manual sign-off, not unit tests. */
function defaultClaudeVersion(): string | null {
  try {
    const out = execFileSync('claude', ['--version'], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    const match = out.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}
function defaultRunClaudeInstall(): { ok: boolean; reason?: string } {
  return { ok: false, reason: 'claude-cli-unavailable' };
}
/* v8 ignore stop */

function record(
  deps: ResolvedDeps,
  prior: MigrationRecord | null,
  patch: Partial<MigrationRecord> & { state: MigrationState },
): MigrationResult {
  const nowIso = deps.now().toISOString();
  const next: MigrationRecord = {
    attempts: prior?.attempts ?? 0,
    npm_sessions_since_install: prior?.npm_sessions_since_install,
    ...prior,
    ...patch,
    version: deps.version,
    last_attempt_at: nowIso,
  };
  if ((patch.state === 'installed' || patch.state === 'done') && !('reason' in patch)) {
    delete next.reason;
  }
  if (patch.state === 'installed' && prior?.state !== 'installed') {
    next.installed_at = nowIso;
    next.counted_sessions = [];
  }
  if (!isConfigSkip(next.state, next.reason)) {
    next.last_real_attempt_at = nowIso;
    next.last_real_reason = next.reason;
  } else if (prior && !prior.last_real_attempt_at && !isConfigSkip(prior.state, prior.reason)) {
    next.last_real_attempt_at = prior.last_attempt_at;
    next.last_real_reason = prior.reason;
  }
  writeMigrationState(deps.home, next);
  return { state: next.state, path: next.path, reason: next.reason };
}

export function maybeMigrateToPlugin(
  projectRoot: string,
  deps: MigrationDeps = {},
): MigrationResult {
  try {
    return runMigration(projectRoot, resolveDeps(deps));
  } catch (error) {
    return { state: 'skipped', reason: `error:${(error as Error).message}` };
  }
}

function runMigration(projectRoot: string, deps: ResolvedDeps): MigrationResult {
  const prior = readMigrationState(deps.home);

  if (doneButDisabled(prior, deps.home)) {
    return record(deps, prior, { state: 'declined', reason: USER_DISABLED_REASON });
  }
  if (prior && isSettled(prior)) {
    return { state: prior.state, path: prior.path, reason: prior.reason };
  }

  if (prior && prior.state === 'installed') {
    const installed = withInstalledAt(deps.home, prior);
    if (isPluginSeenFresh(installed, readPluginSeen(deps.home))) {
      return confirmDone(deps, installed);
    }
    return { state: installed.state, path: installed.path, reason: installed.reason };
  }

  const cfg = resolvePluginMigrationConfig(projectRoot, deps.env);

  if (cfg.install_mode === 'settings') {
    return record(deps, prior, { state: 'skipped', reason: 'install-mode-settings' });
  }
  if (cfg.migration !== 'on' && cfg.install_mode !== 'plugin') {
    return record(deps, prior, { state: 'skipped', reason: 'migration-off' });
  }
  if (!projectTargetsClaudeCode(projectRoot)) {
    return record(deps, prior, { state: 'skipped', reason: 'no-claude-code-provider' });
  }
  if (isCiOrHeadless(deps.env)) {
    return record(deps, prior, { state: 'skipped', reason: 'ci-or-headless' });
  }
  if (!retryAllowed(prior, deps.now())) {
    return { state: prior?.state ?? 'skipped', reason: 'retry-not-due' };
  }
  const policyReason = managedPolicyBlockReason(deps.managedSettingsPaths);
  if (policyReason) {
    return record(deps, prior, {
      state: 'skipped',
      reason: policyReason,
      attempts: (prior?.attempts ?? 0) + 1,
    });
  }
  if (isPluginPresent(deps.home)) {
    return recordPresentPlugin(deps, prior);
  }
  if (!acquireLock(deps.home)) {
    return { state: prior?.state ?? 'skipped', reason: 'locked' };
  }
  try {
    return performInstall(deps, prior);
  } finally {
    releaseLock(deps.home);
  }
}

function recordPresentPlugin(deps: ResolvedDeps, prior: MigrationRecord | null): MigrationResult {
  if (isSyncedRoot(readPluginSeen(deps.home)?.root)) {
    return record(deps, prior, { state: 'done', path: 'synced' });
  }
  const attempts = (prior?.attempts ?? 0) + 1;
  const settings = installViaSettings(deps.home);
  if (settings.state !== 'installed') {
    return record(deps, prior, { state: settings.state, reason: settings.reason, attempts });
  }
  return record(deps, prior, {
    state: 'installed',
    path: 'settings',
    attempts,
    npm_sessions_since_install: 0,
  });
}

function performInstall(deps: ResolvedDeps, prior: MigrationRecord | null): MigrationResult {
  if (userDisabledPlugin(deps.home)) {
    deps.log('user turned the plugin off; not installing');
    return record(deps, prior, { state: 'declined', reason: 'user-opted-out' });
  }
  const attempts = (prior?.attempts ?? 0) + 1;
  const version = deps.claudeVersion();
  if (version !== null && versionAtLeast(version, MIN_CLAUDE_VERSION)) {
    const run = deps.runClaudeInstall(deps.home, deps.env);
    if (run.ok) return recordCliInstall(deps, prior, attempts, 'cli', `claude ${version}`);
    const reason = `path-a-failed:${run.reason ?? 'unknown'}`;
    deps.log(`path A failed (${run.reason ?? 'unknown'})`);
    return record(deps, prior, { state: 'failed', reason, attempts });
  }
  const bundled = deps.bundledClaude();
  if (bundled === null && version !== null) {
    deps.log(`claude ${version} is older than ${MIN_CLAUDE_VERSION} and no bundled claude found`);
    return record(deps, prior, { state: 'skipped', reason: `claude-too-old:${version}`, attempts });
  }
  if (bundled === null) {
    deps.log('no claude on PATH and no bundled claude from the Desktop app');
    return record(deps, prior, { state: 'skipped', reason: 'no-claude-cli', attempts });
  }
  const run = deps.runClaudeInstall(deps.home, deps.env, bundled);
  if (run.ok) return recordCliInstall(deps, prior, attempts, 'bundled-cli', bundled);
  const reason = `bundled-cli-failed:${run.reason ?? 'unknown'}`;
  deps.log(`bundled claude install failed (${run.reason ?? 'unknown'})`);
  return record(deps, prior, { state: 'skipped', reason, attempts });
}

function recordCliInstall(
  deps: ResolvedDeps,
  prior: MigrationRecord | null,
  attempts: number,
  path: 'cli' | 'bundled-cli',
  via: string,
): MigrationResult {
  const settings = installViaSettings(deps.home);
  if (settings.state !== 'installed') {
    deps.log(
      `user settings not written after the ${path} install (${settings.state}: ${settings.reason ?? 'unknown'})`,
    );
  }
  deps.log(`installed via ${path} (${via})`);
  return record(deps, prior, {
    state: 'installed',
    path,
    attempts,
    npm_sessions_since_install: 0,
  });
}

const BUNDLED_CLAUDE_SEARCH_DEPTH = 4;

export function findBundledClaude(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const root = bundledClaudeRoot(home, platform, env);
  if (root === null) return null;
  for (const version of versionFolders(root)) {
    const found = findExecutable(join(root, version), platform, BUNDLED_CLAUDE_SEARCH_DEPTH);
    if (found !== null) return found;
  }
  return null;
}

function bundledClaudeRoot(
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | null {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() ? env.APPDATA : join(home, 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude-code');
  }
  return null;
}

function versionFolders(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name) && isDirectory(join(root, name)))
    .sort((a, b) => (a === b ? 0 : versionAtLeast(a, b) ? -1 : 1));
}

function findExecutable(dir: string, platform: NodeJS.Platform, depth: number): string | null {
  const binary = platform === 'win32' ? 'claude.exe' : 'claude';
  const direct =
    platform === 'win32' ? join(dir, binary) : join(dir, 'claude.app', 'Contents', 'MacOS', binary);
  if (isExecutableFile(direct, platform)) return direct;
  if (depth <= 0) return null;
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const child = join(dir, name);
    if (name === 'claude.app' || !isDirectory(child)) continue;
    const found = findExecutable(child, platform, depth - 1);
    if (found !== null) return found;
  }
  return null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    return platform === 'win32' || process.platform === 'win32' || (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

type PluginSeen = ReturnType<typeof readPluginSeen>;

type InstalledRecord = MigrationRecord & { installed_at: string };

function withInstalledAt(home: string, record: MigrationRecord): InstalledRecord {
  if (record.installed_at) return { ...record, installed_at: record.installed_at };
  const seeded = {
    ...record,
    installed_at: record.last_attempt_at ?? new Date(0).toISOString(),
  };
  writeMigrationState(home, seeded);
  return seeded;
}

function isPluginSeenFresh(prior: InstalledRecord, seen: PluginSeen): boolean {
  if (!seen?.at) return false;
  return new Date(seen.at).getTime() >= new Date(prior.installed_at).getTime();
}

function confirmDone(deps: ResolvedDeps, prior: MigrationRecord): MigrationResult {
  const seen = readPluginSeen(deps.home);
  return record(deps, prior, {
    state: 'done',
    path: isSyncedRoot(seen?.root) ? 'synced' : prior.path,
  });
}

export type SessionSource = 'npm' | 'plugin';

export interface SessionTickDeps extends MigrationDeps {
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SETTLE_MS = 2000;

export async function recordMigrationSession(
  input: { source: SessionSource; sessionId?: string },
  deps: SessionTickDeps = {},
): Promise<MigrationResult> {
  try {
    const resolved = resolveDeps(deps);
    const initial = readMigrationState(resolved.home);
    if (!initial || (initial.state !== 'installed' && !doneButDisabled(initial, resolved.home))) {
      return noTick(initial);
    }
    if (input.source === 'npm') {
      const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      await sleep(deps.settleMs ?? DEFAULT_SETTLE_MS);
    }
    if (!acquireLock(resolved.home)) return { state: initial.state, reason: 'locked' };
    try {
      return tickInstalled(resolved, input);
    } finally {
      releaseLock(resolved.home);
    }
  } catch (error) {
    return { state: 'skipped', reason: `error:${(error as Error).message}` };
  }
}

function noTick(prior: MigrationRecord | null): MigrationResult {
  return { state: prior?.state ?? 'pending', path: prior?.path, reason: 'nothing-to-record' };
}

function tickInstalled(
  deps: ResolvedDeps,
  input: { source: SessionSource; sessionId?: string },
): MigrationResult {
  const current = readMigrationState(deps.home);
  if (doneButDisabled(current, deps.home)) {
    return record(deps, current, { state: 'declined', reason: USER_DISABLED_REASON });
  }
  if (current?.state !== 'installed') return noTick(current);
  const prior = withInstalledAt(deps.home, current);
  if (input.source === 'plugin' || isPluginSeenFresh(prior, readPluginSeen(deps.home))) {
    return confirmDone(deps, prior);
  }
  if (!isPluginInstalledRecord(deps.home)) {
    const waited = deps.now().getTime() - new Date(prior.installed_at).getTime();
    if (waited >= INSTALL_WAIT_MS) {
      return autoRollback(deps, prior, NEVER_INSTALLED_REASON);
    }
    return { state: prior.state, path: prior.path, reason: 'waiting-for-plugin-install' };
  }
  const counted = prior.counted_sessions ?? [];
  if (input.sessionId && counted.includes(input.sessionId)) {
    return { state: prior.state, path: prior.path, reason: 'session-already-counted' };
  }
  const sessions = (prior.npm_sessions_since_install ?? 0) + 1;
  if (sessions >= ROLLBACK_AFTER_NPM_SESSIONS) {
    return autoRollback(deps, prior, AUTO_ROLLBACK_REASON, sessions);
  }
  return record(deps, prior, {
    state: 'installed',
    npm_sessions_since_install: sessions,
    counted_sessions: input.sessionId
      ? [...counted, input.sessionId].slice(-MAX_COUNTED_SESSIONS)
      : counted,
  });
}

function autoRollback(
  deps: ResolvedDeps,
  prior: MigrationRecord,
  reason: string,
  sessions: number = prior.npm_sessions_since_install ?? 0,
): MigrationResult {
  if (isPluginInstalledRecord(deps.home)) deps.runClaudeUninstall(deps.home);
  undoViaSettings(deps.home);
  clearPluginSeen(deps.home);
  deps.log(
    reason === NEVER_INSTALLED_REASON
      ? 'rolled back: Claude Code never installed the plugin'
      : `rolled back after ${sessions} npm sessions with no plugin`,
  );
  return record(deps, prior, {
    state: 'rolled-back',
    reason,
    npm_sessions_since_install: sessions,
  });
}

export const STALE_MIGRATION_LOCK_MS = 15 * 60 * 1000;

export function acquireLock(home: string, now: () => number = Date.now): boolean {
  const dir = migrationLockDir(home);
  try {
    mkdirSync(dirname(dir), { recursive: true });
    mkdirSync(dir);
    return true;
  } catch {
    return reapStaleLock(dir, now);
  }
}

function reapStaleLock(dir: string, now: () => number): boolean {
  try {
    if (now() - statSync(dir).mtimeMs <= STALE_MIGRATION_LOCK_MS) return false;
    const aside = `${dir}.stale-${process.pid}-${now()}`;
    renameSync(dir, aside);
    rmSync(aside, { recursive: true, force: true });
    mkdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
export function releaseLock(home: string): void {
  try {
    rmSync(migrationLockDir(home), { recursive: true, force: true });
  } catch {}
}

export const ROLLBACK_MESSAGE =
  'paqad now runs from the npm package in Claude Code again. The plugin was removed.';

export const ROLLBACK_NO_CLAUDE_MESSAGE =
  'The plugin is turned off. Run `claude plugin uninstall paqad@eliyce` to remove it.';

export const ROLLBACK_NOT_TURNED_OFF_MESSAGE =
  'paqad could not turn the plugin off. Run `claude plugin uninstall paqad@eliyce` to remove it.';

export type ClaudeUninstallOutcome = ClaudeExecOutcome | 'no-claude';

export interface RollbackDeps {
  home?: string;
  now?: () => Date;
  version?: string;
  runClaudeUninstall?: (home: string) => ClaudeUninstallOutcome | void;
  writeInstallModeSettings?: (projectRoot: string) => void;
}

export function rollbackPlugin(projectRoot: string, deps: RollbackDeps = {}): string {
  const home = deps.home ?? homedir();
  const prior = readMigrationState(home);
  const listed = isPluginInstalledRecord(home);
  const outcome = listed && deps.runClaudeUninstall ? deps.runClaudeUninstall(home) : undefined;
  undoViaSettings(home);
  const stillInstalled = listed && outcome !== undefined && outcome !== 'ok';
  const turnedOff = stillInstalled && disableViaSettings(home);
  clearPluginSeen(home);
  writeMigrationState(home, {
    attempts: prior?.attempts ?? 0,
    ...prior,
    state: 'rolled-back',
    reason: 'manual',
    version: deps.version ?? VERSION,
    last_attempt_at: (deps.now ?? (() => new Date()))().toISOString(),
  });
  (
    deps.writeInstallModeSettings ??
    ((root: string) => setConfigValue(root, 'claude_install_mode', 'settings'))
  )(projectRoot);
  if (!stillInstalled) return ROLLBACK_MESSAGE;
  return turnedOff ? ROLLBACK_NO_CLAUDE_MESSAGE : ROLLBACK_NOT_TURNED_OFF_MESSAGE;
}

function disableViaSettings(home: string): boolean {
  const path = userClaudeSettingsPath(home);
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!isRecord(parsed)) return false;
      settings = parsed;
    } catch {
      return false;
    }
  }
  const enabled = isRecord(settings.enabledPlugins) ? settings.enabledPlugins : {};
  const next = { ...settings, enabledPlugins: { ...enabled, [PLUGIN_ID]: false } };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, path);
  } catch {
    return false;
  }
  return true;
}

export interface ClaudeInstallLine {
  detail: string;
  level: 'pass' | 'warning';
  remediation?: string;
}

export interface ClaudeInstallLineOptions {
  managedSettingsPaths?: string[];
  version?: string;
  cliEntry?: string;
}

export const HOOKS_BLOCKED_DETAIL =
  "A managed policy blocks paqad's hooks, so paqad's checks don't run here.";
export const HOOKS_BLOCKED_FIX =
  'Ask IT to deploy the paqad plugin as a managed plugin, or allow its hooks.';
export const PLUGIN_BLOCKED_DETAIL = 'plugin blocked by policy; paqad stays on npm';
export const WAITING_FOR_LOAD_DETAIL =
  'npm (moving to the plugin: waiting for the plugin to load in a new session)';
export const VERSION_MISMATCH_FIX =
  'The plugin and paqad-ai are on different versions. Start a new Claude Code session so the plugin updates, or run `claude plugin update paqad@eliyce`.';

export function describeClaudeInstall(
  home: string = homedir(),
  projectRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ClaudeInstallLineOptions = {},
): ClaudeInstallLine {
  const policy = classifyManagedPolicy(
    options.managedSettingsPaths ?? defaultManagedSettingsPaths(),
  );
  if (policy === 'hooks-blocked') {
    return { detail: HOOKS_BLOCKED_DETAIL, level: 'warning', remediation: HOOKS_BLOCKED_FIX };
  }
  if (policy === 'plugin-blocked') return { detail: PLUGIN_BLOCKED_DETAIL, level: 'pass' };
  const record = readMigrationState(home);
  if (doneButDisabled(record, home)) {
    return { detail: `npm (migration declined: ${USER_DISABLED_REASON})`, level: 'pass' };
  }
  const suffix = (): string =>
    projectRoot !== undefined ? npmHooksSuffix(home, projectRoot, env) : '';
  const installedRecord = isPluginInstalledRecord(home);
  if (installedRecord && !userDisabledPlugin(home) && !hasNpmCopy(home, env, options)) {
    return withPluginVersion('plugin', home, env, options);
  }
  if (
    isSyncedRoot(readPluginSeen(home)?.root) ||
    (record?.state === 'done' && record.path === 'synced')
  ) {
    return { detail: `plugin (synced from claude.ai)${suffix()}`, level: 'pass' };
  }
  if (!record || record.state === 'pending') return { detail: 'npm', level: 'pass' };
  if (record.state === 'done') {
    const date = record.last_attempt_at ? record.last_attempt_at.slice(0, 10) : 'unknown';
    const detail = `plugin (migrated ${date}, via ${record.path ?? 'settings'})${suffix()}`;
    return installedRecord
      ? withPluginVersion(detail, home, env, options)
      : { detail, level: 'pass' };
  }
  if (record.state === 'installed') {
    if (!installedRecord) {
      return {
        detail: 'npm (migration installed: waiting for Claude Code to install the plugin)',
        level: 'pass',
      };
    }
    const fresh = isPluginSeenFresh(withSeededInstalledAt(record), readPluginSeen(home));
    return { detail: fresh ? 'npm (migration installed)' : WAITING_FOR_LOAD_DETAIL, level: 'pass' };
  }
  const reason = record.reason ? `: ${record.reason}` : '';
  return { detail: `npm (migration ${record.state}${reason})`, level: 'pass' };
}

function withSeededInstalledAt(record: MigrationRecord): InstalledRecord {
  return {
    ...record,
    installed_at: record.installed_at ?? record.last_attempt_at ?? new Date(0).toISOString(),
  };
}

function hasNpmCopy(
  home: string,
  env: NodeJS.ProcessEnv,
  options: ClaudeInstallLineOptions,
): boolean {
  const entry = options.cliEntry ?? process.argv[1] ?? '';
  if (entry.includes('node_modules')) return true;
  const link = env.PAQAD_FRAMEWORK_HOME ?? join(home, '.paqad-ai', 'current');
  try {
    return classifyFrameworkCopy(readlinkSync(link)) === 'npm';
  } catch {
    return false;
  }
}

function withPluginVersion(
  detail: string,
  home: string,
  env: NodeJS.ProcessEnv,
  options: ClaudeInstallLineOptions,
): ClaudeInstallLine {
  const plugin = readInstalledPluginVersion(home, env);
  if (plugin === null) return { detail, level: 'pass' };
  const own = options.version ?? VERSION;
  const line = `${detail}; plugin v${plugin}, paqad-ai v${own}`;
  return plugin === own
    ? { detail: line, level: 'pass' }
    : { detail: line, level: 'warning', remediation: VERSION_MISMATCH_FIX };
}

export function readInstalledPluginVersion(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configDir = claudeConfigDir(home, env);
  for (const entry of installedPluginEntries(configDir)) {
    const installPath = typeof entry.installPath === 'string' ? entry.installPath : null;
    const fromRoot = installPath === null ? null : readPackageVersion(installPath);
    if (fromRoot !== null) return fromRoot;
    if (typeof entry.version === 'string' && entry.version !== '') return entry.version;
  }
  const data = env.CLAUDE_PLUGIN_DATA?.trim()
    ? env.CLAUDE_PLUGIN_DATA
    : join(configDir, 'plugins', 'data', 'paqad-eliyce');
  return readRuntimeCopyVersion(join(data, 'runtime'));
}

function claudeConfigDir(home: string, env: NodeJS.ProcessEnv): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  return configDir ? configDir : join(home, '.claude');
}

function installedPluginEntries(configDir: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const value = isRecord(parsed.plugins) ? parsed.plugins[PLUGIN_ID] : parsed[PLUGIN_ID];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isRecord);
}

export const PROJECT_NPM_HOOKS_SUFFIX =
  '; this project still runs the npm hooks (project .claude/settings.json)';

function hookUserSettingsPath(home: string, env: NodeJS.ProcessEnv): string {
  return join(claudeConfigDir(home, env), 'settings.json');
}

function userSettingsLabel(home: string, env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR?.trim()
    ? hookUserSettingsPath(home, env)
    : '~/.claude/settings.json';
}

function npmHooksSuffix(home: string, projectRoot: string, env: NodeJS.ProcessEnv): string {
  const user = settingsWireLivePaqadHook(hookUserSettingsPath(home, env));
  const project = projectWiresLiveNpmHooks(projectRoot);
  if (!user) return project ? PROJECT_NPM_HOOKS_SUFFIX : '';
  const files = project
    ? `${userSettingsLabel(home, env)} and project .claude/settings.json`
    : userSettingsLabel(home, env);
  return `; this project still runs the npm hooks (${files})`;
}

export function projectWiresLiveNpmHooks(projectRoot: string): boolean {
  return ['settings.json', 'settings.local.json'].some((name) =>
    settingsWireLivePaqadHook(join(projectRoot, '.claude', name)),
  );
}

function settingsWireLivePaqadHook(settingsPath: string): boolean {
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return false;
  }
  const hooks = isRecord(settings) ? settings.hooks : undefined;
  if (!isRecord(hooks)) return false;
  return Object.values(hooks).some(
    (entries) =>
      Array.isArray(entries) &&
      entries.some(
        (entry) =>
          isRecord(entry) &&
          Array.isArray(entry.hooks) &&
          entry.hooks.some((hook) => {
            const script = paqadHookScript(isRecord(hook) ? hook.command : undefined);
            return script !== null && existsSync(script);
          }),
      ),
  );
}

function paqadHookScript(command: unknown): string | null {
  if (typeof command !== 'string' || !command.includes('paqad')) return null;
  const match = /"([^"]+\.mjs)"|(\S+\.mjs)/.exec(command);
  const path = match ? (match[1] ?? match[2]) : undefined;
  return path !== undefined && path.includes('paqad') ? path : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type ClaudeExecOutcome = 'ok' | 'exit' | 'timeout' | 'error';

export type ClaudeExec = (
  args: readonly string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => ClaudeExecOutcome;

export type ClaudeInstallRunner = (
  home: string,
  env: NodeJS.ProcessEnv,
  bin?: string,
) => { ok: boolean; reason?: string };

export function claudeExecFor(bin: string): ClaudeExec {
  return (args, options) => defaultClaudeExec(args, options, bin);
}

export function runClaudeInstallWith(
  home: string,
  env: NodeJS.ProcessEnv,
  bin?: string,
): { ok: boolean; reason?: string } {
  return runClaudePluginInstall(
    home,
    env,
    bin === undefined ? defaultClaudeExec : claudeExecFor(bin),
  );
}

/* v8 ignore start -- the one real process-spawning binding; every branch above it is unit tested
   through the injected exec seam. */
export function defaultClaudeExec(
  args: readonly string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
  bin: string = 'claude',
): ClaudeExecOutcome {
  const result = spawnSync(bin, [...args], {
    env: options.env,
    timeout: options.timeoutMs,
    stdio: 'ignore',
    windowsHide: true,
    shell: process.platform === 'win32' && bin === 'claude',
  });
  if (result.error) {
    return (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : 'error';
  }
  return result.status === 0 ? 'ok' : 'exit';
}
/* v8 ignore stop */

export function runClaudePluginInstall(
  home: string,
  env: NodeJS.ProcessEnv,
  exec: ClaudeExec = defaultClaudeExec,
  log: (message: string) => void = (message) => appendMigrationLog(home, message),
): { ok: boolean; reason?: string } {
  const added = exec(['plugin', 'marketplace', 'add', PLUGIN_MARKETPLACE_REPO], {
    timeoutMs: MARKETPLACE_ADD_TIMEOUT_MS,
    env,
  });
  if (added !== 'ok') {
    log(`marketplace add ${PLUGIN_MARKETPLACE_REPO} did not succeed (${added}); continuing`);
  }
  const installed = exec(['plugin', 'install', PLUGIN_ID, '--scope', 'user'], {
    timeoutMs: INSTALL_TIMEOUT_MS,
    env,
  });
  if (installed !== 'ok') return { ok: false, reason: `cli-install-failed:${installed}` };
  if (!isPluginInstalledRecord(home)) return { ok: false, reason: 'cli-install-unconfirmed' };
  return { ok: true };
}

export interface UninstallDeps {
  env?: NodeJS.ProcessEnv;
  claudeVersion?: () => string | null;
  bundledClaude?: () => string | null;
  exec?: ClaudeExec;
  log?: (message: string) => void;
}

export function runClaudePluginUninstall(
  home: string,
  deps: UninstallDeps = {},
): ClaudeUninstallOutcome {
  const log = deps.log ?? ((message: string) => appendMigrationLog(home, message));
  try {
    let exec: ClaudeExec | null = null;
    let via = 'cli';
    if ((deps.claudeVersion ?? defaultClaudeVersion)() !== null) {
      exec = deps.exec ?? defaultClaudeExec;
    } else {
      const bundled = (deps.bundledClaude ?? (() => findBundledClaude(home)))();
      if (bundled !== null) {
        exec = deps.exec ?? claudeExecFor(bundled);
        via = 'bundled-cli';
      }
    }
    if (exec === null) {
      log('uninstall skipped: no claude on PATH and no bundled claude');
      return 'no-claude';
    }
    const outcome = exec(['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user'], {
      timeoutMs: UNINSTALL_TIMEOUT_MS,
      env: deps.env ?? process.env,
    });
    log(`uninstall via ${via}: ${outcome}`);
    return outcome;
  } catch (error) {
    log(`uninstall via cli: error (${(error as Error).message})`);
    return 'error';
  }
}
