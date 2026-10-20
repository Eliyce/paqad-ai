// Claude Code npm → plugin migration (issue #621).
//
// Moves existing npm Claude Code users to the paqad plugin automatically and safely, OFF by
// default (`plugin_migration=off`). It runs best-effort at the end of `paqad-ai update --silent`
// (the existing background self-update), never throws, never blocks, and never prints in a
// session. The npm package is never removed and stays the fallback; only the user's own Claude
// Code settings (never a tracked project file) are ever touched.
//
// Everything is dependency-injected (home dir, clock, the `claude` CLI probe + install, the
// managed-settings paths) so the whole state machine is unit-testable against a sandboxed home
// without a real Claude Code install.

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

/** The marketplace the plugin ships from (the claude.ai / CLI source). */
export const PLUGIN_MARKETPLACE_REPO = 'Eliyce/paqad-ai';
const MARKETPLACE_KEY = 'eliyce';

/** Bounded timeouts for the synchronous `claude plugin` runs, so a hung CLI never holds the update. */
const MARKETPLACE_ADD_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const UNINSTALL_TIMEOUT_MS = 120_000;

/** Minimum `claude` version whose `plugin` subcommands this migration drives (Part 3, Path A). */
export const MIN_CLAUDE_VERSION = '2.1.295';

/** The machine-level migration state (Part 5). */
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
  /** npm SessionStarts seen since `installed` with no sign of the plugin (Part 4 rollback count). */
  npm_sessions_since_install?: number;
  /** When the state last became `installed`; plugin-seen freshness is judged against it (B4). */
  installed_at?: string;
  /**
   * The npm session ids counted toward the rollback since `installed` (the last
   * {@link MAX_COUNTED_SESSIONS}), so one session counts once even when sessions interleave (B4).
   */
  counted_sessions?: string[];
  /**
   * When and why the last REAL write happened (anything but a config skip). A config skip
   * rewrites `last_attempt_at` and `reason`, so the retry window of a real prior attempt is
   * judged from these instead (B7).
   */
  last_real_attempt_at?: string;
  last_real_reason?: string;
}

/** Injectable seams so the state machine is testable without a real environment. */
export interface MigrationDeps {
  env?: NodeJS.ProcessEnv;
  /** Home dir (sandboxed in tests). */
  home?: string;
  now?: () => Date;
  /** The running paqad version recorded into the state file. */
  version?: string;
  /** `claude --version` → the semver string, or null when there is no usable `claude` on PATH. */
  claudeVersion?: () => string | null;
  runClaudeInstall?: ClaudeInstallRunner;
  bundledClaude?: () => string | null;
  /** `claude plugin uninstall`, run by the automatic rollback when Claude Code lists the plugin. */
  runClaudeUninstall?: (home: string) => void;
  /** The managed-settings files to inspect (defaults per-OS); injectable for tests. */
  managedSettingsPaths?: string[];
  /** Best-effort logger (defaults to the migration log file). */
  log?: (message: string) => void;
}

/** The result of one `maybeMigrateToPlugin` call. */
export interface MigrationResult {
  state: MigrationState;
  path?: MigrationPath;
  reason?: string;
}

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MANAGED_POLICY_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ROLLBACK_AFTER_NPM_SESSIONS = 3;
/**
 * Issue #670: how long an `installed` move waits for Claude Code to install the plugin before it
 * rolls back. Sessions before the install do not count toward {@link ROLLBACK_AFTER_NPM_SESSIONS}.
 */
const INSTALL_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
/** Bound on the remembered session ids; well above the rollback threshold. */
const MAX_COUNTED_SESSIONS = 10;

// ── Paths ────────────────────────────────────────────────────────────────────

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

// ── State file (Part 5) ────────────────────────────────────────────────────

export function readMigrationState(home: string): MigrationRecord | null {
  try {
    return JSON.parse(readFileSync(migrationStatePath(home), 'utf8')) as MigrationRecord;
  } catch {
    return null;
  }
}

/** Write the state file atomically (temp then rename). Best-effort; never throws. */
export function writeMigrationState(home: string, record: MigrationRecord): void {
  const path = migrationStatePath(home);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(tmp, path);
  } catch {
    /* best-effort: a failed state write must not break the background update */
  }
}

// ── Plugin presence (Parts 2.6 + 9.2) ────────────────────────────────────────

/** The `plugin-seen.json` the plugin's SessionStart writes when it runs, or null. */
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

/**
 * Remove `plugin-seen.json` after a rollback, so a stale marker from before the undo cannot make
 * the next retry look "already present" and skip the real install. The plugin rewrites it the
 * next time it runs. Best-effort; never throws.
 */
function clearPluginSeen(home: string): void {
  try {
    rmSync(pluginSeenPath(home), { force: true });
  } catch {
    /* best-effort: a leftover marker only costs one extra confirmation pass */
  }
}

export function isSyncedRoot(root: string | undefined): boolean {
  if (typeof root !== 'string') return false;
  const path = root.replaceAll('\\', '/');
  if (path.includes('/plugins/synced/')) return true;
  const sessions = path.indexOf('/Claude/local-agent-mode-sessions/');
  return sessions !== -1 && path.indexOf('/rpm/plugin_', sessions) !== -1;
}

/**
 * The plugin is present when Claude Code records it in `installed_plugins.json` OR the plugin
 * itself has written `plugin-seen.json` (the claude.ai synced route leaves no install record, so
 * the plugin's own marker is the second signal — Part 9.2).
 */
export function isPluginPresent(home: string): boolean {
  return isPluginInstalledRecord(home) || readPluginSeen(home) !== null;
}

/** True when Claude Code's `installed_plugins.json` lists the paqad plugin. */
function isPluginInstalledRecord(home: string): boolean {
  const installed = join(home, '.claude', 'plugins', 'installed_plugins.json');
  try {
    return JSON.stringify(JSON.parse(readFileSync(installed, 'utf8'))).includes(PLUGIN_ID);
  } catch {
    return false; // absent or unreadable → no install record
  }
}

/** True when the user's own Claude settings turn the paqad plugin off (`enabledPlugins` false). */
function userDisabledPlugin(home: string): boolean {
  try {
    const settings = JSON.parse(readFileSync(userClaudeSettingsPath(home), 'utf8')) as {
      enabledPlugins?: Record<string, unknown>;
    };
    return settings.enabledPlugins?.[PLUGIN_ID] === false;
  } catch {
    return false; // absent or unreadable settings are not an opt-out
  }
}

/** A settled `done` the user then turned off: paqad records it as declined and never re-adds (B5). */
function doneButDisabled(record: MigrationRecord | null, home: string): boolean {
  return record?.state === 'done' && userDisabledPlugin(home);
}

const USER_DISABLED_REASON = 'user-disabled';

// ── Skip conditions (Part 2) ──────────────────────────────────────────────────

function isCiOrHeadless(env: NodeJS.ProcessEnv): boolean {
  return (
    (typeof env.CI === 'string' && env.CI !== '') ||
    (typeof env.PAQAD_HEADLESS === 'string' && env.PAQAD_HEADLESS !== '') ||
    env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli'
  );
}

/** True when the onboarded project targets Claude Code (manifest adapter or a CLAUDE.md artifact). */
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

/** The managed-settings files Claude Code reads on the current platform (Part 2.7). */
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
  } catch {
    /* no managed-settings.d — only the single file (if any) is read */
  }
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

/** True when a marketplace list references the paqad plugin's github source. */
function marketplaceReferenced(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes(PLUGIN_MARKETPLACE_REPO));
}

/**
 * Skips that record a config or environment decision, not a real attempt. They never start a retry
 * window of their own, so a Developer who opts in a minute after a skip is not made to wait a day
 * (B7). They never erase one either: the attempt cap and a real prior attempt's window still hold.
 */
const CONFIG_SKIP_REASONS: ReadonlySet<string> = new Set([
  'migration-off',
  'install-mode-settings',
  'no-claude-code-provider',
  'ci-or-headless',
]);

/** The reason an automatic rollback records; it is retried, unlike a manual rollback (B3). */
const AUTO_ROLLBACK_REASON = 'plugin-never-loaded';

/**
 * Issue #670: the automatic rollback when Claude Code never installed the plugin within
 * {@link INSTALL_WAIT_MS} of the move. Retried like {@link AUTO_ROLLBACK_REASON}.
 */
const NEVER_INSTALLED_REASON = 'plugin-never-installed';

/** The automatic rollback reasons; both go back through the retry rules (B3, #670). */
const AUTO_ROLLBACK_REASONS = new Set([AUTO_ROLLBACK_REASON, NEVER_INSTALLED_REASON]);

/**
 * A settled record is never retried: `done`, `declined`, or a `rolled-back` that was not an
 * automatic undo (a manual rollback stays final). An automatic rollback goes back through the
 * retry window and attempt cap, so a later run completes once access is back (B3).
 */
function isSettled(record: MigrationRecord): boolean {
  if (record.state === 'rolled-back') return !AUTO_ROLLBACK_REASONS.has(record.reason ?? '');
  return record.state === 'done' || record.state === 'declined';
}

/** Whether the retry rules (Part 5) allow another attempt now. */
export function retryAllowed(record: MigrationRecord | null, now: Date): boolean {
  if (!record) return true;
  if (isSettled(record)) return false;
  if (record.attempts >= MAX_ATTEMPTS) return false;
  // A config skip is judged by the last real attempt before it (none → allowed at once).
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

/** True for a skip that records a config or environment decision (B7). */
function isConfigSkip(state: MigrationState, reason: string | undefined): boolean {
  return state === 'skipped' && CONFIG_SKIP_REASONS.has(reason ?? '');
}

// ── Install paths (Part 3) ────────────────────────────────────────────────────

/** The two additive keys paqad merges into the user settings (Path B). */
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

/**
 * Path B — merge ONLY the two additive keys into the user `~/.claude/settings.json`, preserving
 * every other key byte for byte (read-modify-write to a temp file then rename). Returns the
 * resulting state. Invalid JSON is left untouched (`failed`); a pre-existing
 * `enabledPlugins["paqad@eliyce"] === false` is a prior opt-out (`declined`).
 */
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

/** Remove the two keys paqad added, preserving every other user-settings key (Path B undo). */
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
  } catch {
    /* best-effort */
  }
}

export { versionAtLeast };

// ── Orchestrator (Part 2 → Part 4) ────────────────────────────────────────────

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

/** Append a line to the migration log; best-effort, never throws. */
function appendMigrationLog(home: string, message: string): void {
  try {
    const path = migrationLogPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
  } catch {
    /* best-effort */
  }
}

/* v8 ignore start -- the real `claude --version` probe + detached install are exercised through the
   injected seams; the process-spawning defaults are covered by manual sign-off, not unit tests. */
function defaultClaudeVersion(): string | null {
  // Probe `claude --version` on PATH; a missing/erroring binary means "no usable claude" → Path B.
  try {
    const out = execFileSync('claude', ['--version'], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      // claude is a .cmd shim on Windows; static args only, so the shell is safe.
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

/** Record a terminal/interim state and return the result. */
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
  // installed and done carry no failure reason; drop one left over from an earlier state.
  if ((patch.state === 'installed' || patch.state === 'done') && !('reason' in patch)) {
    delete next.reason;
  }
  // A fresh move into `installed` restarts the freshness clock; a counter bump keeps it.
  if (patch.state === 'installed' && prior?.state !== 'installed') {
    next.installed_at = nowIso;
    next.counted_sessions = [];
  }
  // Only a real write moves the retry baseline; a config skip keeps the prior one (B7).
  if (!isConfigSkip(next.state, next.reason)) {
    next.last_real_attempt_at = nowIso;
    next.last_real_reason = next.reason;
  } else if (prior && !prior.last_real_attempt_at && !isConfigSkip(prior.state, prior.reason)) {
    // An older record (written before these fields existed): its own write was the real one.
    next.last_real_attempt_at = prior.last_attempt_at;
    next.last_real_reason = prior.reason;
  }
  writeMigrationState(deps.home, next);
  return { state: next.state, path: next.path, reason: next.reason };
}

/**
 * The migration entry the background update calls (Part 2). Best-effort, synchronous decision; the
 * Path-A install runs through the injected runner (synchronous, bounded). Never throws.
 */
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

  // The user turned the plugin off after the move: record declined, touch nothing (B5).
  if (doneButDisabled(prior, deps.home)) {
    return record(deps, prior, { state: 'declined', reason: USER_DISABLED_REASON });
  }
  // Already settled — never retry (Part 5). An automatic rollback is not settled (B3).
  if (prior && isSettled(prior)) {
    return { state: prior.state, path: prior.path, reason: prior.reason };
  }

  // Already installed by paqad: confirm it ran (Part 4/9). The update path never counts a session;
  // only a real SessionStart does, through recordMigrationSession (B4).
  if (prior && prior.state === 'installed') {
    const installed = withInstalledAt(deps.home, prior);
    if (isPluginSeenFresh(installed, readPluginSeen(deps.home))) {
      return confirmDone(deps, installed);
    }
    return { state: installed.state, path: installed.path, reason: installed.reason };
  }

  const cfg = resolvePluginMigrationConfig(projectRoot, deps.env);

  // Part 2 skip conditions, each recording its reason.
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
  installViaSettings(deps.home);
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
    return platform === 'win32' || (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

type PluginSeen = ReturnType<typeof readPluginSeen>;

/**
 * An `installed` record written before `installed_at` existed: seed it ONCE from the record's own
 * `last_attempt_at` (the epoch when that is missing too) and persist it, so later counter bumps,
 * which rewrite `last_attempt_at`, never move the freshness baseline (B4).
 */
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

/** True when the plugin wrote `plugin-seen.json` after the move into `installed` (B4). */
function isPluginSeenFresh(prior: InstalledRecord, seen: PluginSeen): boolean {
  if (!seen?.at) return false;
  return new Date(seen.at).getTime() >= new Date(prior.installed_at).getTime();
}

/** Move `installed` to `done` (Part 4/9); `synced` when the plugin ran from the claude.ai cache. */
function confirmDone(deps: ResolvedDeps, prior: MigrationRecord): MigrationResult {
  const seen = readPluginSeen(deps.home);
  return record(deps, prior, {
    state: 'done',
    path: isSyncedRoot(seen?.root) ? 'synced' : prior.path,
  });
}

/** Which copy's SessionStart reported the session. */
export type SessionSource = 'npm' | 'plugin';

/** Seams for {@link recordMigrationSession}, on top of the migration seams. */
export interface SessionTickDeps extends MigrationDeps {
  /** How long an npm tick waits for a parallel plugin SessionStart to write plugin-seen. */
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SETTLE_MS = 2000;

/**
 * Part 4 / Part 9 — the one place a real Claude Code session moves the migration (B4). A plugin
 * session, or an npm session that finds a fresh plugin-seen, moves `installed` to `done`. Until
 * Claude Code lists the plugin as installed, an npm session only waits (issue #670), and the move
 * rolls back as `plugin-never-installed` once {@link INSTALL_WAIT_MS} has passed. After the
 * install, an npm session with no sign of the plugin bumps the counter once per distinct session
 * id, and at {@link ROLLBACK_AFTER_NPM_SESSIONS} runs the automatic rollback. Takes the machine lock (does
 * nothing when it is held) and never throws.
 */
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
      // The plugin and npm SessionStart hooks run in parallel; give plugin-seen a moment to land.
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

/** The no-op result when there is nothing for a session to move. */
function noTick(prior: MigrationRecord | null): MigrationResult {
  return { state: prior?.state ?? 'pending', path: prior?.path, reason: 'nothing-to-record' };
}

/** Under the lock: re-read the state, then confirm, count, or roll back. */
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
  // Issue #670: until Claude Code installs the plugin (Desktop does it on a later start), an npm
  // session says nothing about whether the plugin loads, so it is not counted. Past the wait the
  // install is taken as never coming and the move is undone, retryably.
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

/**
 * The automatic undo (Part 4): remove the plugin when Claude Code lists it, drop the settings
 * keys, and record a retryable `rolled-back` so a later run starts clean (B3).
 */
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

// ── Lock (Part 2) ──────────────────────────────────────────────────────────

/**
 * A lock older than this was left by a killed run. The longest hold is a Path A install
 * (`claude --version` probe 120s + marketplace add 120s + install 180s = 7 min), so 15 min is
 * safely above any live holder.
 */
export const STALE_MIGRATION_LOCK_MS = 15 * 60 * 1000;

export function acquireLock(home: string, now: () => number = Date.now): boolean {
  const dir = migrationLockDir(home);
  try {
    mkdirSync(dirname(dir), { recursive: true });
    mkdirSync(dir); // atomic: fails if it already exists
    return true;
  } catch {
    return reapStaleLock(dir, now);
  }
}

/**
 * Reap a lock left behind by a killed run, then take it once. The stale dir is renamed aside
 * first (atomic), so two reapers cannot both remove it; the loser's mkdir then fails.
 */
function reapStaleLock(dir: string, now: () => number): boolean {
  try {
    if (now() - statSync(dir).mtimeMs <= STALE_MIGRATION_LOCK_MS) return false;
    const aside = `${dir}.stale-${process.pid}-${now()}`;
    renameSync(dir, aside);
    rmSync(aside, { recursive: true, force: true });
    mkdirSync(dir);
    return true;
  } catch {
    return false; // vanished, raced, or unreadable: treat as held
  }
}
export function releaseLock(home: string): void {
  try {
    rmSync(migrationLockDir(home), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// ── Rollback command (Part 6) ────────────────────────────────────────────────

export const ROLLBACK_MESSAGE =
  'paqad now runs from the npm package in Claude Code again. The plugin was removed.';

export const ROLLBACK_NO_CLAUDE_MESSAGE =
  'The plugin is turned off. Run `claude plugin uninstall paqad@eliyce` to remove it.';

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
  if (stillInstalled) disableViaSettings(home);
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
  return stillInstalled ? ROLLBACK_NO_CLAUDE_MESSAGE : ROLLBACK_MESSAGE;
}

function disableViaSettings(home: string): void {
  const path = userClaudeSettingsPath(home);
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!isRecord(parsed)) return;
      settings = parsed;
    } catch {
      return;
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
    return;
  }
}

// ── Doctor line (Part 7) ──────────────────────────────────────────────────────

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
  for (const entry of installedPluginEntries(home)) {
    const installPath = typeof entry.installPath === 'string' ? entry.installPath : null;
    const fromRoot = installPath === null ? null : readPackageVersion(installPath);
    if (fromRoot !== null) return fromRoot;
    if (typeof entry.version === 'string' && entry.version !== '') return entry.version;
  }
  const data = env.CLAUDE_PLUGIN_DATA?.trim()
    ? env.CLAUDE_PLUGIN_DATA
    : join(home, '.claude', 'plugins', 'data', 'paqad-eliyce');
  return readRuntimeCopyVersion(join(data, 'runtime'));
}

function installedPluginEntries(home: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'),
    );
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const value = isRecord(parsed.plugins) ? parsed.plugins[PLUGIN_ID] : parsed[PLUGIN_ID];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isRecord);
}

/** The doctor suffix for a plugin-done machine whose project still runs the npm hooks (#667). */
export const PROJECT_NPM_HOOKS_SUFFIX =
  '; this project still runs the npm hooks (project .claude/settings.json)';

/**
 * Issue #674: the user-level Claude settings file the npm hooks may be wired in. Mirrors
 * `claudeSettingsPath` in runtime/hooks/lib/paqad-disabled.mjs: `CLAUDE_CONFIG_DIR` when it is set
 * and non-blank, else `~/.claude`. Only the doctor read uses it; the migration writes keep going
 * through {@link userClaudeSettingsPath}.
 */
function hookUserSettingsPath(home: string, env: NodeJS.ProcessEnv): string {
  const configDir = env.CLAUDE_CONFIG_DIR;
  return configDir?.trim()
    ? join(configDir, 'settings.json')
    : join(home, '.claude', 'settings.json');
}

/** How the doctor names the user settings file: `~/.claude/...`, or the real CLAUDE_CONFIG_DIR path. */
function userSettingsLabel(home: string, env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR?.trim()
    ? hookUserSettingsPath(home, env)
    : '~/.claude/settings.json';
}

/**
 * Issue #674: the plugin-done suffix naming what keeps the npm hooks on, checked in the
 * `pluginStandsDownPassive` order: the user settings file first, then the project's own files.
 * Empty when neither wires a live paqad hook.
 */
function npmHooksSuffix(home: string, projectRoot: string, env: NodeJS.ProcessEnv): string {
  const user = settingsWireLivePaqadHook(hookUserSettingsPath(home, env));
  const project = projectWiresLiveNpmHooks(projectRoot);
  if (!user) return project ? PROJECT_NPM_HOOKS_SUFFIX : '';
  const files = project
    ? `${userSettingsLabel(home, env)} and project .claude/settings.json`
    : userSettingsLabel(home, env);
  return `; this project still runs the npm hooks (${files})`;
}

/**
 * Issue #667: true when the project's `.claude/settings.json` or `.claude/settings.local.json`
 * wires a LIVE paqad npm hook, one whose `.mjs` script exists on disk. A missing or malformed file
 * counts as not wired. This mirrors `hasLiveNpmHookLines` / `paqadHookScriptPath` in
 * runtime/hooks/lib/paqad-disabled.mjs (limited to the project files), because src cannot import
 * the dist-less runtime hook libraries.
 */
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
    return false; // missing or malformed: not wired
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

/** The `.mjs` script a paqad hook command runs, or null when it is not a paqad hook. */
function paqadHookScript(command: unknown): string | null {
  if (typeof command !== 'string' || !command.includes('paqad')) return null;
  const match = /"([^"]+\.mjs)"|(\S+\.mjs)/.exec(command);
  const path = match ? (match[1] ?? match[2]) : undefined;
  return path !== undefined && path.includes('paqad') ? path : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ── `claude plugin` runners (Path A real implementation) ─────────────────────
// They run synchronously: `update --silent` is already a detached background process, so waiting
// for the CLI here never blocks a session, and it lets us check the result (B2).

/** How one `claude` run ended. */
export type ClaudeExecOutcome = 'ok' | 'exit' | 'timeout' | 'error';

/** Runs `claude <args>` and reports how it ended; never throws. Injected in tests. */
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

/**
 * Path A: register the marketplace, install the plugin at user scope, and confirm Claude Code
 * recorded it. A failed `marketplace add` is tolerated (it may already be registered); the
 * install exit code plus the `installed_plugins.json` record decide success. Never throws.
 */
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
