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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { resolvePluginMigrationConfig, setConfigValue } from '@/core/framework-config.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import { VERSION } from '@/index.js';

import { PLUGIN_ID } from '../health/plugin-install.js';

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

/** Which install path performed (or would undo) the move. */
export type MigrationPath = 'cli' | 'settings' | 'synced';

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
  /** The last npm session id counted toward the rollback, so one session counts once (B4). */
  last_counted_session?: string;
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
  /** Path A: run the `claude plugin` install; returns ok + an optional failure reason. */
  runClaudeInstall?: (home: string, env: NodeJS.ProcessEnv) => { ok: boolean; reason?: string };
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

/** True when a plugin root path is a claude.ai synced-plugin cache (Part 9.3). */
export function isSyncedRoot(root: string | undefined): boolean {
  return (
    typeof root === 'string' &&
    (root.includes('/plugins/synced/') || root.includes('\\plugins\\synced\\'))
  );
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

/**
 * Inspect the readable managed-settings files for a policy that would stop the plugin, returning a
 * short reason or null. Server-managed policy can't be read from disk; it surfaces as a failed
 * download in Part 4 instead.
 */
export function managedPolicyBlockReason(paths: string[]): string | null {
  for (const path of paths) {
    let policy: Record<string, unknown>;
    try {
      policy = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      continue; // absent or unreadable → not a blocking signal
    }
    if (policy.allowManagedHooksOnly === true) return 'managed-policy';
    if (policy.disableAllHooks === true) return 'managed-policy';
    const enabled = policy.enabledPlugins as Record<string, unknown> | undefined;
    if (enabled && enabled[PLUGIN_ID] === false) return 'managed-policy';
    const strict = policy.strictKnownMarketplaces;
    if (Array.isArray(strict) && !marketplaceReferenced(strict)) return 'managed-policy';
    const blocked = policy.blockedMarketplaces;
    if (Array.isArray(blocked) && marketplaceReferenced(blocked)) return 'managed-policy';
  }
  return null;
}

/** True when a marketplace list references the paqad plugin's github source. */
function marketplaceReferenced(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes(PLUGIN_MARKETPLACE_REPO));
}

/**
 * Skips that record a config or environment decision, not a real attempt. They never throttle the
 * next run, so a Developer who opts in a minute after a skip is not made to wait a day (B7).
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
 * A settled record is never retried: `done`, `declined`, or a `rolled-back` that was not the
 * automatic undo (a manual rollback stays final). An automatic rollback goes back through the
 * retry window and attempt cap, so a later run completes once access is back (B3).
 */
function isSettled(record: MigrationRecord): boolean {
  if (record.state === 'rolled-back') return record.reason !== AUTO_ROLLBACK_REASON;
  return record.state === 'done' || record.state === 'declined';
}

/** Whether the retry rules (Part 5) allow another attempt now. */
export function retryAllowed(record: MigrationRecord | null, now: Date): boolean {
  if (!record) return true;
  if (record.state === 'skipped' && CONFIG_SKIP_REASONS.has(record.reason ?? '')) return true;
  if (isSettled(record)) return false;
  if (record.attempts >= MAX_ATTEMPTS) return false;
  if (!record.last_attempt_at) return true;
  const since = now.getTime() - new Date(record.last_attempt_at).getTime();
  const window = record.reason === 'managed-policy' ? MANAGED_POLICY_RECHECK_MS : RETRY_WINDOW_MS;
  return since >= window;
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

/** Parse an `x.y.z` version to a comparable tuple. */
function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}
/** True when `a` >= `b` (semver-ish, numeric segments only). */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

// ── Orchestrator (Part 2 → Part 4) ────────────────────────────────────────────

interface ResolvedDeps {
  env: NodeJS.ProcessEnv;
  home: string;
  now: () => Date;
  version: string;
  claudeVersion: () => string | null;
  runClaudeInstall: (home: string, env: NodeJS.ProcessEnv) => { ok: boolean; reason?: string };
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
  // A fresh move into `installed` restarts the freshness clock; a counter bump keeps it.
  if (patch.state === 'installed' && prior?.state !== 'installed') next.installed_at = nowIso;
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

  // Already settled — never retry (Part 5). An automatic rollback is not settled (B3).
  if (prior && isSettled(prior)) {
    return { state: prior.state, path: prior.path, reason: prior.reason };
  }

  // Already installed by paqad: confirm it ran (Part 4/9). The update path never counts a session;
  // only a real SessionStart does, through recordMigrationSession (B4).
  if (prior && prior.state === 'installed') {
    if (isPluginSeenFresh(prior, readPluginSeen(deps.home))) return confirmDone(deps, prior);
    return { state: prior.state, path: prior.path, reason: prior.reason };
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
  // Already present → jump straight to confirmation (Part 2.6 / Part 9).
  if (isPluginPresent(deps.home)) {
    if (isSyncedRoot(readPluginSeen(deps.home)?.root)) {
      return record(deps, prior, { state: 'done', path: 'synced' });
    }
    // Re-declare the settings keys so a leftover install record (a retry after an automatic
    // rollback with no claude to uninstall) is enabled again; an explicit user false is declined.
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
  const policyReason = managedPolicyBlockReason(deps.managedSettingsPaths);
  if (policyReason) {
    return record(deps, prior, {
      state: 'skipped',
      reason: policyReason,
      attempts: (prior?.attempts ?? 0) + 1,
    });
  }

  // Single-flight machine lock (Part 2) — only one migration runs per machine.
  if (!acquireLock(deps.home)) {
    return { state: prior?.state ?? 'skipped', reason: 'locked' };
  }
  try {
    return performInstall(deps, prior);
  } finally {
    releaseLock(deps.home);
  }
}

/** Run the install (Path A when a usable `claude` exists, else Path B) and record `installed`. */
function performInstall(deps: ResolvedDeps, prior: MigrationRecord | null): MigrationResult {
  const attempts = (prior?.attempts ?? 0) + 1;
  const version = deps.claudeVersion();
  const pathA = version !== null && versionAtLeast(version, MIN_CLAUDE_VERSION);

  if (pathA) {
    const run = deps.runClaudeInstall(deps.home, deps.env);
    if (run.ok) {
      // Both paths end in the same declared user-settings state.
      installViaSettings(deps.home);
      deps.log(`installed via cli (claude ${version})`);
      return record(deps, prior, {
        state: 'installed',
        path: 'cli',
        attempts,
        npm_sessions_since_install: 0,
      });
    }
    deps.log(`path A failed (${run.reason ?? 'unknown'}); falling back to settings`);
  }

  const result = installViaSettings(deps.home);
  if (result.state === 'installed') {
    deps.log('installed via settings');
    return record(deps, prior, {
      state: 'installed',
      path: 'settings',
      attempts,
      npm_sessions_since_install: 0,
    });
  }
  deps.log(`settings install did not complete: ${result.state} (${result.reason ?? ''})`);
  return record(deps, prior, { state: result.state, reason: result.reason, attempts });
}

type PluginSeen = ReturnType<typeof readPluginSeen>;

/**
 * True when the plugin wrote `plugin-seen.json` after the move into `installed`. Older records
 * have no `installed_at`, so they fall back to `last_attempt_at` (B4).
 */
function isPluginSeenFresh(prior: MigrationRecord, seen: PluginSeen): boolean {
  if (!seen?.at) return false;
  const since = prior.installed_at ?? prior.last_attempt_at;
  const installedAt = since ? new Date(since).getTime() : 0;
  return new Date(seen.at).getTime() >= installedAt;
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
 * session, or an npm session that finds a fresh plugin-seen, moves `installed` to `done`. An npm
 * session with no sign of the plugin bumps the counter once per distinct session id, and at
 * {@link ROLLBACK_AFTER_NPM_SESSIONS} runs the automatic rollback. Takes the machine lock (does
 * nothing when it is held) and never throws.
 */
export async function recordMigrationSession(
  input: { source: SessionSource; sessionId?: string },
  deps: SessionTickDeps = {},
): Promise<MigrationResult> {
  try {
    const resolved = resolveDeps(deps);
    const initial = readMigrationState(resolved.home);
    if (initial?.state !== 'installed') return noTick(initial);
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
  const prior = readMigrationState(deps.home);
  if (prior?.state !== 'installed') return noTick(prior);
  if (input.source === 'plugin' || isPluginSeenFresh(prior, readPluginSeen(deps.home))) {
    return confirmDone(deps, prior);
  }
  if (input.sessionId && prior.last_counted_session === input.sessionId) {
    return { state: prior.state, path: prior.path, reason: 'session-already-counted' };
  }
  const sessions = (prior.npm_sessions_since_install ?? 0) + 1;
  if (sessions >= ROLLBACK_AFTER_NPM_SESSIONS) {
    return autoRollback(deps, prior, sessions);
  }
  return record(deps, prior, {
    state: 'installed',
    npm_sessions_since_install: sessions,
    last_counted_session: input.sessionId,
  });
}

/**
 * The automatic undo (Part 4): remove the plugin when Claude Code lists it, drop the settings
 * keys, and record a retryable `rolled-back` so a later run starts clean (B3).
 */
function autoRollback(
  deps: ResolvedDeps,
  prior: MigrationRecord,
  sessions: number,
): MigrationResult {
  if (isPluginInstalledRecord(deps.home)) deps.runClaudeUninstall(deps.home);
  undoViaSettings(deps.home);
  deps.log(`rolled back after ${sessions} npm sessions with no plugin`);
  return record(deps, prior, {
    state: 'rolled-back',
    reason: AUTO_ROLLBACK_REASON,
    npm_sessions_since_install: sessions,
  });
}

// ── Lock (Part 2) ──────────────────────────────────────────────────────────

export function acquireLock(home: string): boolean {
  const dir = migrationLockDir(home);
  try {
    mkdirSync(dirname(dir), { recursive: true });
    mkdirSync(dir); // atomic: fails if it already exists
    return true;
  } catch {
    return false;
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

export interface RollbackDeps {
  home?: string;
  now?: () => Date;
  version?: string;
  /** `claude plugin uninstall`, run when Claude Code lists the plugin (any path); injected for tests. */
  runClaudeUninstall?: (home: string) => void;
  /** Writes `claude_install_mode=settings` to the project's local `.paqad/.config`. */
  writeInstallModeSettings?: (projectRoot: string) => void;
}

/**
 * `paqad-ai plugin rollback` — remove the plugin, undo the settings keys, record `rolled-back`
 * (reason `manual`), pin `claude_install_mode=settings` locally so it never re-migrates, and
 * return the message to print verbatim. The uninstall runs whenever Claude Code lists the plugin,
 * on any path, because Claude Code may have installed it from the settings keys too (B6).
 */
export function rollbackPlugin(projectRoot: string, deps: RollbackDeps = {}): string {
  const home = deps.home ?? homedir();
  const prior = readMigrationState(home);
  if (deps.runClaudeUninstall && isPluginInstalledRecord(home)) {
    deps.runClaudeUninstall(home);
  }
  undoViaSettings(home);
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
  return ROLLBACK_MESSAGE;
}

// ── Doctor line (Part 7) ──────────────────────────────────────────────────────

/**
 * The one-line Claude Code install state `paqad-ai doctor` reports (Part 7): `npm` when no move
 * has happened, `plugin (migrated <date>, via <path>)` once done, `plugin (synced from claude.ai)`
 * for the synced route, or `npm (migration <state>: <reason>)` while a move is in flight or undone.
 * paqad never prints this in a Claude session — only `doctor` surfaces it.
 */
export function describeClaudeInstall(home: string = homedir()): string {
  const record = readMigrationState(home);
  if (!record || record.state === 'pending') return 'npm';
  if (record.state === 'done') {
    if (record.path === 'synced') return 'plugin (synced from claude.ai)';
    const date = record.last_attempt_at ? record.last_attempt_at.slice(0, 10) : 'unknown';
    return `plugin (migrated ${date}, via ${record.path ?? 'settings'})`;
  }
  return `npm (migration ${record.state}: ${record.reason ?? 'n/a'})`;
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

/* v8 ignore start -- the one real process-spawning binding; every branch above it is unit tested
   through the injected exec seam. */
export function defaultClaudeExec(
  args: readonly string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
): ClaudeExecOutcome {
  const result = spawnSync('claude', [...args], {
    env: options.env,
    timeout: options.timeoutMs,
    stdio: 'ignore',
    windowsHide: true,
    // claude is a .cmd shim on Windows; static args only, so the shell is safe.
    shell: process.platform === 'win32',
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

/** Injectable seams for {@link runClaudePluginUninstall}. */
export interface UninstallDeps {
  env?: NodeJS.ProcessEnv;
  claudeVersion?: () => string | null;
  exec?: ClaudeExec;
  log?: (message: string) => void;
}

/**
 * Run `claude plugin uninstall paqad@eliyce --scope user` when a `claude` is on PATH. Logs the
 * outcome and never throws; with no `claude` it runs nothing (the settings undo still applies).
 */
export function runClaudePluginUninstall(home: string, deps: UninstallDeps = {}): void {
  const log = deps.log ?? ((message: string) => appendMigrationLog(home, message));
  try {
    if ((deps.claudeVersion ?? defaultClaudeVersion)() === null) {
      log('uninstall skipped: no claude on PATH');
      return;
    }
    const outcome = (deps.exec ?? defaultClaudeExec)(
      ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user'],
      { timeoutMs: UNINSTALL_TIMEOUT_MS, env: deps.env ?? process.env },
    );
    log(`uninstall via cli: ${outcome}`);
  } catch (error) {
    log(`uninstall via cli: error (${(error as Error).message})`);
  }
}
