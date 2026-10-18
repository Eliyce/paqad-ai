import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireLock,
  defaultManagedSettingsPaths,
  describeClaudeInstall,
  installViaSettings,
  PLUGIN_MARKETPLACE_REPO,
  isPluginPresent,
  isSyncedRoot,
  managedPolicyBlockReason,
  maybeMigrateToPlugin,
  type MigrationDeps,
  migrationLockDir,
  migrationLogPath,
  migrationStatePath,
  projectTargetsClaudeCode,
  pluginSeenPath,
  readMigrationState,
  recordMigrationSession,
  releaseLock,
  retryAllowed,
  rollbackPlugin,
  runClaudePluginInstall,
  runClaudePluginUninstall,
  STALE_MIGRATION_LOCK_MS,
  type ClaudeExec,
  type ClaudeExecOutcome,
  undoViaSettings,
  versionAtLeast,
  writeMigrationState,
} from '@/install/plugin-migration.js';

let home: string;
let projectRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'paqad-mig-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'paqad-mig-proj-'));
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Onboard the fixture project for Claude Code (manifest adapter). */
function manifestClaudeCode(): void {
  writeFileSync(
    join(projectRoot, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
  );
}

/** Base deps that reach the install step: migration on, no claude CLI (Path B), no policy. */
function baseDeps(over: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    env: { PAQAD_PLUGIN_MIGRATION: 'on' },
    home,
    now: () => new Date('2026-10-17T12:00:00Z'),
    version: '1.96.1',
    claudeVersion: () => null,
    managedSettingsPaths: [],
    log: () => {},
    ...over,
  };
}

function userSettings(): string {
  return join(home, '.claude', 'settings.json');
}

describe('state file (Part 5)', () => {
  it('round-trips atomically', () => {
    writeMigrationState(home, { state: 'installed', path: 'settings', attempts: 1, version: '1' });
    expect(readMigrationState(home)?.state).toBe('installed');
    expect(existsSync(migrationStatePath(home))).toBe(true);
  });
  it('returns null when absent or malformed', () => {
    expect(readMigrationState(home)).toBeNull();
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(migrationStatePath(home), 'not json');
    expect(readMigrationState(home)).toBeNull();
  });
});

describe('lock (Part 2)', () => {
  it('is single-flight: a second acquire fails until released', () => {
    expect(acquireLock(home)).toBe(true);
    expect(acquireLock(home)).toBe(false);
    releaseLock(home);
    expect(acquireLock(home)).toBe(true);
  });
  it('reaps a lock older than the stale bound and takes it', () => {
    expect(acquireLock(home)).toBe(true);
    const lockAge = statSync(migrationLockDir(home)).mtimeMs;
    expect(acquireLock(home, () => lockAge + STALE_MIGRATION_LOCK_MS)).toBe(false); // at the bound
    expect(acquireLock(home, () => lockAge + STALE_MIGRATION_LOCK_MS + 1)).toBe(true);
    expect(existsSync(migrationLockDir(home))).toBe(true);
    // The reaper now holds a fresh lock, so a normal acquire still fails.
    expect(acquireLock(home)).toBe(false);
    expect(readdirSync(dirname(migrationLockDir(home)))).toEqual(['plugin-migration.lock']);
  });
  it('treats an unreadable lock path as held', () => {
    // The parent "locks" is a FILE: mkdir fails and stat cannot reach the lock either.
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(join(home, '.paqad-ai', 'locks'), 'x');
    expect(acquireLock(home, () => Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe('projectTargetsClaudeCode', () => {
  it('is true for a claude-code adapter manifest', () => {
    manifestClaudeCode();
    expect(projectTargetsClaudeCode(projectRoot)).toBe(true);
  });
  it('is true when a CLAUDE.md artifact is recorded under another adapter', () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ adapter: 'codex-cli', generated_artifacts: [{ path: 'CLAUDE.md' }] }),
    );
    expect(projectTargetsClaudeCode(projectRoot)).toBe(true);
  });
  it('is false for a non-claude manifest and when absent', () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ adapter: 'codex-cli', generated_artifacts: [{ path: 'AGENTS.md' }] }),
    );
    expect(projectTargetsClaudeCode(projectRoot)).toBe(false);
    expect(projectTargetsClaudeCode(mkdtempSync(join(tmpdir(), 'empty-')))).toBe(false);
  });
});

describe('managedPolicyBlockReason (Part 2.7)', () => {
  function policyFile(policy: unknown): string {
    const path = join(home, 'managed-settings.json');
    writeFileSync(path, JSON.stringify(policy));
    return path;
  }
  it('returns null for no files / absent / empty policy', () => {
    expect(managedPolicyBlockReason([])).toBeNull();
    expect(managedPolicyBlockReason([join(home, 'nope.json')])).toBeNull();
    expect(managedPolicyBlockReason([policyFile({})])).toBeNull();
  });
  it('blocks on each policy signal', () => {
    expect(managedPolicyBlockReason([policyFile({ allowManagedHooksOnly: true })])).toBe(
      'managed-policy',
    );
    expect(managedPolicyBlockReason([policyFile({ disableAllHooks: true })])).toBe(
      'managed-policy',
    );
    expect(
      managedPolicyBlockReason([policyFile({ enabledPlugins: { 'paqad@eliyce': false } })]),
    ).toBe('managed-policy');
    expect(
      managedPolicyBlockReason([policyFile({ strictKnownMarketplaces: ['other/repo'] })]),
    ).toBe('managed-policy');
    expect(
      managedPolicyBlockReason([
        policyFile({ blockedMarketplaces: [{ repo: 'Eliyce/paqad-ai' }] }),
      ]),
    ).toBe('managed-policy');
  });
  it('does not block when strictKnownMarketplaces allows the paqad source', () => {
    expect(
      managedPolicyBlockReason([
        policyFile({ strictKnownMarketplaces: [{ repo: 'Eliyce/paqad-ai' }] }),
      ]),
    ).toBeNull();
  });
  it('blocks when strictKnownMarketplaces lists only the old, wrong repo (B1)', () => {
    expect(
      managedPolicyBlockReason([
        policyFile({ strictKnownMarketplaces: [{ repo: 'Eliyce/paqad-plugin' }] }),
      ]),
    ).toBe('managed-policy');
  });
  it('the marketplace constant is the real paqad marketplace repo (B1)', () => {
    expect(PLUGIN_MARKETPLACE_REPO).toBe('Eliyce/paqad-ai');
  });
});

describe('retryAllowed (Part 5)', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  it('allows when no record', () => {
    expect(retryAllowed(null, now)).toBe(true);
  });
  it('never retries settled states', () => {
    for (const state of ['done', 'rolled-back', 'declined'] as const) {
      expect(retryAllowed({ state, attempts: 1, version: '1' }, now)).toBe(false);
    }
  });
  it('stops after 5 attempts', () => {
    expect(retryAllowed({ state: 'failed', attempts: 5, version: '1' }, now)).toBe(false);
  });
  it('honours the 24h window for failed/skipped', () => {
    const recent = {
      state: 'failed' as const,
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T06:00:00Z',
    };
    expect(retryAllowed(recent, now)).toBe(false); // 6h < 24h
    const old = { ...recent, last_attempt_at: '2026-10-16T06:00:00Z' };
    expect(retryAllowed(old, now)).toBe(true); // 30h >= 24h
  });
  it('honours the 7-day window for a managed-policy skip', () => {
    const rec = {
      state: 'skipped' as const,
      reason: 'managed-policy',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-15T12:00:00Z',
    };
    expect(retryAllowed(rec, now)).toBe(false); // 2d < 7d
    expect(retryAllowed({ ...rec, last_attempt_at: '2026-10-09T12:00:00Z' }, now)).toBe(true); // 8d
  });
  it('never throttles a config or environment skip (B7)', () => {
    for (const reason of [
      'migration-off',
      'install-mode-settings',
      'no-claude-code-provider',
      'ci-or-headless',
    ]) {
      expect(
        retryAllowed(
          {
            state: 'skipped',
            reason,
            attempts: 1,
            version: '1',
            last_attempt_at: '2026-10-17T11:59:00Z',
          },
          now,
        ),
      ).toBe(true);
    }
  });
  it('a config skip still honours the attempt cap', () => {
    expect(
      retryAllowed({ state: 'skipped', reason: 'migration-off', attempts: 5, version: '1' }, now),
    ).toBe(false);
  });
  it('a config skip keeps the window of the real attempt before it', () => {
    const skip = {
      state: 'skipped' as const,
      reason: 'install-mode-settings',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T11:59:00Z',
    };
    // A failed attempt 6h ago: 24h window still running.
    expect(retryAllowed({ ...skip, last_real_attempt_at: '2026-10-17T06:00:00Z' }, now)).toBe(
      false,
    );
    expect(retryAllowed({ ...skip, last_real_attempt_at: '2026-10-16T06:00:00Z' }, now)).toBe(true);
    // A managed-policy skip 2 days ago keeps its 7-day window through a config skip.
    expect(
      retryAllowed(
        {
          ...skip,
          last_real_attempt_at: '2026-10-15T12:00:00Z',
          last_real_reason: 'managed-policy',
        },
        now,
      ),
    ).toBe(false);
  });
  it('still throttles a skipped record with no reason', () => {
    expect(
      retryAllowed(
        { state: 'skipped', attempts: 1, version: '1', last_attempt_at: '2026-10-17T11:59:00Z' },
        now,
      ),
    ).toBe(false);
  });
});

describe('installed and done records carry no stale reason', () => {
  it('a retry after a failure installs with the old reason cleared', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'failed',
      reason: 'user-settings-write-failed',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-16T00:00:00Z',
    });
    expect(maybeMigrateToPlugin(projectRoot, baseDeps())).toEqual({
      state: 'installed',
      path: 'settings',
      reason: undefined,
    });
    expect(readMigrationState(home)?.reason).toBeUndefined();
  });
  it('a confirmation to done clears the reason too', async () => {
    writeMigrationState(home, {
      state: 'installed',
      path: 'settings',
      reason: 'leftover',
      attempts: 1,
      version: '1',
    });
    await tick('plugin');
    expect(readMigrationState(home)).toMatchObject({ state: 'done' });
    expect(readMigrationState(home)?.reason).toBeUndefined();
  });
});

describe('config skips do not throttle a later opt-in (B7)', () => {
  it('toggling claude_install_mode cannot bypass the cap or a real attempt window', () => {
    manifestClaudeCode();
    const at = (iso: string) => () => new Date(iso);
    // A real failed attempt one hour ago, at the cap.
    writeMigrationState(home, {
      state: 'failed',
      reason: 'user-settings-write-failed',
      attempts: 5,
      version: '1',
      last_attempt_at: '2026-10-17T11:00:00Z',
    });
    const toggle = (mode: string) =>
      maybeMigrateToPlugin(
        projectRoot,
        baseDeps({ env: { PAQAD_CLAUDE_INSTALL_MODE: mode }, now: at('2026-10-17T12:00:00Z') }),
      );
    expect(toggle('plugin').reason).toBe('retry-not-due');
    expect(toggle('settings').reason).toBe('install-mode-settings');
    expect(toggle('plugin').reason).toBe('retry-not-due');
    expect(readMigrationState(home)?.attempts).toBe(5);
    // Below the cap, the 24h window of the failed attempt survives the toggle.
    writeMigrationState(home, {
      state: 'failed',
      reason: 'user-settings-write-failed',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T11:00:00Z',
    });
    toggle('settings');
    expect(toggle('plugin').reason).toBe('retry-not-due');
    expect(
      maybeMigrateToPlugin(
        projectRoot,
        baseDeps({ env: { PAQAD_CLAUDE_INSTALL_MODE: 'plugin' }, now: at('2026-10-18T11:30:00Z') }),
      ).state,
    ).toBe('installed');
  });
  it('installs at once after a migration-off skip a minute earlier', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'skipped',
      reason: 'migration-off',
      attempts: 0,
      version: '1',
      last_attempt_at: '2026-10-17T11:59:00Z',
    });
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ env: { PAQAD_CLAUDE_INSTALL_MODE: 'plugin' } }),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
  });
  it('install-mode-settings skips without writing settings, then installs on switch (AC-17)', () => {
    manifestClaudeCode();
    const first = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ env: { PAQAD_CLAUDE_INSTALL_MODE: 'settings' } }),
    );
    expect(first).toEqual({ state: 'skipped', reason: 'install-mode-settings' });
    expect(existsSync(userSettings())).toBe(false);
    const second = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({
        env: { PAQAD_CLAUDE_INSTALL_MODE: 'plugin' },
        now: () => new Date('2026-10-17T12:01:00Z'),
      }),
    );
    expect(second).toMatchObject({ state: 'installed' });
  });
});

describe('installViaSettings / undoViaSettings (Path B)', () => {
  it('merges the two keys and preserves every other key byte for byte', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      userSettings(),
      JSON.stringify(
        { theme: 'dark', model: 'opus', enabledPlugins: { 'other@x': true } },
        null,
        2,
      ),
    );
    expect(installViaSettings(home).state).toBe('installed');
    const after = JSON.parse(readFileSync(userSettings(), 'utf8'));
    expect(after.theme).toBe('dark');
    expect(after.model).toBe('opus');
    expect(after.enabledPlugins['other@x']).toBe(true);
    expect(after.enabledPlugins['paqad@eliyce']).toBe(true);
    expect(after.extraKnownMarketplaces.eliyce.source.repo).toBe('Eliyce/paqad-ai');
    expect(after.extraKnownMarketplaces.eliyce.autoUpdate).toBe(true);
  });
  it('creates the file when absent', () => {
    expect(installViaSettings(home).state).toBe('installed');
    expect(existsSync(userSettings())).toBe(true);
  });
  it('leaves invalid JSON untouched and records failed', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), '{ not json');
    expect(installViaSettings(home)).toEqual({
      state: 'failed',
      reason: 'user-settings-unreadable',
    });
    expect(readFileSync(userSettings(), 'utf8')).toBe('{ not json');
  });
  it('records declined when the user already turned the plugin off', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }));
    expect(installViaSettings(home).state).toBe('declined');
  });
  it('undo removes only the two keys', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ theme: 'dark' }));
    installViaSettings(home);
    undoViaSettings(home);
    const after = JSON.parse(readFileSync(userSettings(), 'utf8'));
    expect(after.theme).toBe('dark');
    expect(after.enabledPlugins['paqad@eliyce']).toBeUndefined();
    expect(after.extraKnownMarketplaces.eliyce).toBeUndefined();
  });
  it('undo is a no-op on unreadable settings', () => {
    expect(() => undoViaSettings(home)).not.toThrow();
  });
});

describe('versionAtLeast', () => {
  it('compares semver-ish strings', () => {
    expect(versionAtLeast('2.1.300', '2.1.295')).toBe(true);
    expect(versionAtLeast('2.1.295', '2.1.295')).toBe(true);
    expect(versionAtLeast('2.1.100', '2.1.295')).toBe(false);
    expect(versionAtLeast('v2.2.0', '2.1.295')).toBe(true);
  });
});

describe('isPluginPresent / isSyncedRoot (Parts 2.6 + 9)', () => {
  it('detects an installed_plugins record', () => {
    const p = join(home, '.claude', 'plugins');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'installed_plugins.json'), JSON.stringify({ 'paqad@eliyce': {} }));
    expect(isPluginPresent(home)).toBe(true);
  });
  it('detects a plugin-seen marker (synced route)', () => {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(pluginSeenPath(home), JSON.stringify({ version: '1', at: 'now' }));
    expect(isPluginPresent(home)).toBe(true);
  });
  it('is false when neither signal exists', () => {
    expect(isPluginPresent(home)).toBe(false);
  });
  it('isSyncedRoot recognises the synced cache path', () => {
    expect(isSyncedRoot('/u/.claude/plugins/synced/paqad')).toBe(true);
    expect(isSyncedRoot('/u/.claude/plugins/cache/paqad')).toBe(false);
    expect(isSyncedRoot(undefined)).toBe(false);
  });
});

describe('maybeMigrateToPlugin — skip conditions (Part 2)', () => {
  it('skips when migration is off (default)', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(projectRoot, baseDeps({ env: {} }));
    expect(r).toEqual({ state: 'skipped', reason: 'migration-off' });
  });
  it('skips when install mode is settings, even with migration on', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ env: { PAQAD_PLUGIN_MIGRATION: 'on', PAQAD_CLAUDE_INSTALL_MODE: 'settings' } }),
    );
    expect(r.reason).toBe('install-mode-settings');
  });
  it('runs when install mode is plugin even while migration is off', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ env: { PAQAD_CLAUDE_INSTALL_MODE: 'plugin' } }),
    );
    expect(r.state).toBe('installed');
  });
  it('skips when the project does not target claude-code', () => {
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.reason).toBe('no-claude-code-provider');
  });
  it('skips in CI / headless / sdk', () => {
    manifestClaudeCode();
    expect(
      maybeMigrateToPlugin(
        projectRoot,
        baseDeps({ env: { PAQAD_PLUGIN_MIGRATION: 'on', CI: '1' } }),
      ).reason,
    ).toBe('ci-or-headless');
    expect(
      maybeMigrateToPlugin(
        projectRoot,
        baseDeps({ env: { PAQAD_PLUGIN_MIGRATION: 'on', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }),
      ).reason,
    ).toBe('ci-or-headless');
  });
  it('skips with managed-policy and counts the attempt', () => {
    manifestClaudeCode();
    const policy = join(home, 'managed-settings.json');
    writeFileSync(policy, JSON.stringify({ disableAllHooks: true }));
    const r = maybeMigrateToPlugin(projectRoot, baseDeps({ managedSettingsPaths: [policy] }));
    expect(r.reason).toBe('managed-policy');
    expect(readMigrationState(home)?.attempts).toBe(1);
  });
  it('goes straight to done when a synced plugin is already present', () => {
    manifestClaudeCode();
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(
      pluginSeenPath(home),
      JSON.stringify({ version: '1', at: 'now', root: '/u/.claude/plugins/synced/paqad' }),
    );
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r).toMatchObject({ state: 'done', path: 'synced' });
  });
});

describe('maybeMigrateToPlugin — install (Part 3)', () => {
  it('installs via Path B (settings) when there is no usable claude', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
    expect(existsSync(userSettings())).toBe(true);
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(0);
  });
  it('installs via Path A when a new-enough claude runs the install', () => {
    manifestClaudeCode();
    const runClaudeInstall = vi.fn(() => ({ ok: true }));
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ claudeVersion: () => '2.1.300', runClaudeInstall }),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'cli' });
    expect(runClaudeInstall).toHaveBeenCalledOnce();
  });
  it('falls back to Path B when Path A fails to start', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({
        claudeVersion: () => '2.1.300',
        runClaudeInstall: () => ({ ok: false, reason: 'x' }),
      }),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
  });
  it('records declined (no reinstall) when the user had turned the plugin off', () => {
    manifestClaudeCode();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }));
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.state).toBe('declined');
  });
  it('never runs Path A against an explicit opt-out, and the decline is final', () => {
    manifestClaudeCode();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }));
    const before = readFileSync(userSettings(), 'utf8');
    const runClaudeInstall = vi.fn(() => ({ ok: true }));
    const deps = baseDeps({ claudeVersion: () => '2.1.300', runClaudeInstall });
    expect(maybeMigrateToPlugin(projectRoot, deps)).toMatchObject({
      state: 'declined',
      reason: 'user-opted-out',
    });
    expect(maybeMigrateToPlugin(projectRoot, deps).state).toBe('declined');
    expect(runClaudeInstall).not.toHaveBeenCalled();
    expect(readFileSync(userSettings(), 'utf8')).toBe(before);
    expect(readMigrationState(home)?.attempts).toBe(0);
  });
});

/** Write Claude Code's install record for the paqad plugin into the sandboxed home. */
function writeInstalledRecord(): void {
  const p = join(home, '.claude', 'plugins');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'installed_plugins.json'), JSON.stringify({ 'paqad@eliyce': {} }));
}

/** An injected `claude` runner: returns the scripted outcome per subcommand and records argv. */
function fakeExec(
  outcomes: {
    marketplace?: ClaudeExecOutcome;
    install?: ClaudeExecOutcome;
    uninstall?: ClaudeExecOutcome;
  },
  onInstall?: () => void,
): { exec: ClaudeExec; calls: { args: string[]; timeoutMs: number }[] } {
  const calls: { args: string[]; timeoutMs: number }[] = [];
  const exec: ClaudeExec = (args, options) => {
    calls.push({ args: [...args], timeoutMs: options.timeoutMs });
    if (args[1] === 'marketplace') return outcomes.marketplace ?? 'ok';
    if (args[1] === 'install') {
      const outcome = outcomes.install ?? 'ok';
      if (outcome === 'ok') onInstall?.();
      return outcome;
    }
    return outcomes.uninstall ?? 'ok';
  };
  return { exec, calls };
}

describe('runClaudePluginInstall (Path A, B2)', () => {
  it('adds the marketplace, then installs at user scope, with exact args and bounded timeouts', () => {
    const { exec, calls } = fakeExec({}, writeInstalledRecord);
    const log = vi.fn();
    expect(runClaudePluginInstall(home, {}, exec, log)).toEqual({ ok: true });
    expect(calls).toEqual([
      { args: ['plugin', 'marketplace', 'add', 'Eliyce/paqad-ai'], timeoutMs: 120_000 },
      { args: ['plugin', 'install', 'paqad@eliyce', '--scope', 'user'], timeoutMs: 180_000 },
    ]);
    expect(log).not.toHaveBeenCalled();
  });
  it('tolerates a failed marketplace add (already registered) and still installs', () => {
    const { exec } = fakeExec({ marketplace: 'exit' }, writeInstalledRecord);
    const log = vi.fn();
    expect(runClaudePluginInstall(home, {}, exec, log)).toEqual({ ok: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('marketplace add'));
  });
  it('reports each install failure kind', () => {
    for (const outcome of ['exit', 'timeout', 'error'] as const) {
      const { exec } = fakeExec({ install: outcome });
      expect(runClaudePluginInstall(home, {}, exec, () => {})).toEqual({
        ok: false,
        reason: `cli-install-failed:${outcome}`,
      });
    }
  });
  it('reports cli-install-unconfirmed when exit 0 leaves no install record', () => {
    const { exec } = fakeExec({});
    expect(runClaudePluginInstall(home, {}, exec, () => {})).toEqual({
      ok: false,
      reason: 'cli-install-unconfirmed',
    });
  });
  it('logs to the migration log by default', () => {
    const { exec } = fakeExec({ marketplace: 'error' }, writeInstalledRecord);
    runClaudePluginInstall(home, {}, exec);
    expect(readFileSync(migrationLogPath(home), 'utf8')).toContain('marketplace add');
  });
});

describe('maybeMigrateToPlugin — Path A result is checked (B2)', () => {
  function pathADeps(exec: ClaudeExec, log: (m: string) => void): MigrationDeps {
    return baseDeps({
      claudeVersion: () => '2.1.300',
      runClaudeInstall: (h, env) => runClaudePluginInstall(h, env, exec, log),
      log,
    });
  }
  it('installs via cli when marketplace add fails but install succeeds with a record (AC-1)', () => {
    manifestClaudeCode();
    const { exec } = fakeExec({ marketplace: 'exit' }, writeInstalledRecord);
    const r = maybeMigrateToPlugin(
      projectRoot,
      pathADeps(exec, () => {}),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'cli' });
  });
  it('falls back to settings and logs the reason when install exits non-zero (AC-4)', () => {
    manifestClaudeCode();
    const lines: string[] = [];
    const { exec } = fakeExec({ install: 'exit' });
    const r = maybeMigrateToPlugin(
      projectRoot,
      pathADeps(exec, (m) => lines.push(m)),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
    expect(lines).toContain('path A failed (cli-install-failed:exit); falling back to settings');
    expect(
      JSON.parse(readFileSync(userSettings(), 'utf8')).extraKnownMarketplaces.eliyce.source.repo,
    ).toBe('Eliyce/paqad-ai');
  });
  it('falls back on an unconfirmed install or a timeout (AC-5)', () => {
    for (const [outcome, reason] of [
      ['ok', 'cli-install-unconfirmed'],
      ['timeout', 'cli-install-failed:timeout'],
    ] as const) {
      rmSync(home, { recursive: true, force: true });
      mkdirSync(home, { recursive: true });
      manifestClaudeCode();
      const lines: string[] = [];
      const { exec } = fakeExec({ install: outcome });
      const r = maybeMigrateToPlugin(
        projectRoot,
        pathADeps(exec, (m) => lines.push(m)),
      );
      expect(r).toMatchObject({ state: 'installed', path: 'settings' });
      expect(lines).toContain(`path A failed (${reason}); falling back to settings`);
    }
  });
});

describe('maybeMigrateToPlugin — confirm or undo (Part 4)', () => {
  function installed(extra: Record<string, unknown> = {}): void {
    writeMigrationState(home, {
      state: 'installed',
      path: 'settings',
      attempts: 1,
      version: '1.96.1',
      last_attempt_at: '2026-10-17T10:00:00Z',
      npm_sessions_since_install: 0,
      ...extra,
    });
  }
  it('moves to done once plugin-seen is newer than the install', () => {
    manifestClaudeCode();
    installed();
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(
      pluginSeenPath(home),
      JSON.stringify({ version: '1', at: '2026-10-17T11:00:00Z' }),
    );
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.state).toBe('done');
  });
  it('update --silent never bumps the session counter (AC-10)', () => {
    manifestClaudeCode();
    installed({ npm_sessions_since_install: 2 });
    for (let i = 0; i < 5; i += 1) {
      expect(maybeMigrateToPlugin(projectRoot, baseDeps())).toEqual({
        state: 'installed',
        path: 'settings',
        reason: undefined,
      });
    }
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(2);
  });
});

/** One SessionStart tick with an instant settle. */
function tick(
  source: 'npm' | 'plugin',
  sessionId?: string,
  over: Partial<MigrationDeps> = {},
): ReturnType<typeof recordMigrationSession> {
  return recordMigrationSession(
    { source, sessionId },
    { ...baseDeps(over), sleep: async () => {} },
  );
}

describe('recordMigrationSession — real sessions move the migration (B4)', () => {
  function installed(extra: Record<string, unknown> = {}): void {
    writeMigrationState(home, {
      state: 'installed',
      path: 'settings',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T11:30:00Z',
      installed_at: '2026-10-17T10:00:00Z',
      npm_sessions_since_install: 0,
      ...extra,
    });
  }
  function seen(at: string, root?: string): void {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(pluginSeenPath(home), JSON.stringify({ version: '1', at, root }));
  }
  it('rolls back on the third distinct npm session and uninstalls (AC-8)', async () => {
    installed();
    writeInstalledRecord();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': true } }));
    const runClaudeUninstall = vi.fn();
    expect((await tick('npm', 's1', { runClaudeUninstall })).state).toBe('installed');
    expect((await tick('npm', 's2', { runClaudeUninstall })).state).toBe('installed');
    expect(runClaudeUninstall).not.toHaveBeenCalled();
    expect(await tick('npm', 's3', { runClaudeUninstall })).toMatchObject({
      state: 'rolled-back',
      reason: 'plugin-never-loaded',
    });
    expect(runClaudeUninstall).toHaveBeenCalledWith(home);
    const after = JSON.parse(readFileSync(userSettings(), 'utf8'));
    expect(after.enabledPlugins['paqad@eliyce']).toBeUndefined();
  });
  it('counts a repeated session id once (INV-8)', async () => {
    installed();
    await tick('npm', 's1');
    expect(await tick('npm', 's1')).toMatchObject({ reason: 'session-already-counted' });
    expect(readMigrationState(home)).toMatchObject({
      npm_sessions_since_install: 1,
      counted_sessions: ['s1'],
    });
  });
  it('interleaved sessions A, B, A count twice, not three times (INV-8)', async () => {
    installed();
    await tick('npm', 'A');
    await tick('npm', 'B');
    expect(await tick('npm', 'A')).toMatchObject({
      state: 'installed',
      reason: 'session-already-counted',
    });
    expect(readMigrationState(home)).toMatchObject({
      npm_sessions_since_install: 2,
      counted_sessions: ['A', 'B'],
    });
  });
  it('remembers at most the last 10 session ids', async () => {
    installed({
      npm_sessions_since_install: 0,
      counted_sessions: Array.from({ length: 10 }, (_, i) => `old-${i}`),
    });
    await tick('npm', 'new');
    const ids = readMigrationState(home)?.counted_sessions ?? [];
    expect(ids).toHaveLength(10);
    expect(ids.at(-1)).toBe('new');
    expect(ids).not.toContain('old-0');
  });
  it('a fresh install forgets the sessions counted before it', async () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'rolled-back',
      reason: 'plugin-never-loaded',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-16T00:00:00Z',
      counted_sessions: ['A', 'B', 'C'],
    });
    maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(readMigrationState(home)).toMatchObject({ state: 'installed', counted_sessions: [] });
  });
  it('counts a session with no id (nothing to dedupe on)', async () => {
    installed({ npm_sessions_since_install: undefined });
    await tick('npm');
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(1);
  });
  it('a plugin session moves installed to done without counting (AC-9)', async () => {
    installed();
    expect(await tick('plugin', 'p1')).toMatchObject({ state: 'done', path: 'settings' });
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(0);
  });
  it('a plugin session from the claude.ai cache records done via synced', async () => {
    installed();
    seen('2026-10-17T09:00:00Z', '/u/.claude/plugins/synced/paqad');
    expect(await tick('plugin')).toMatchObject({ state: 'done', path: 'synced' });
  });
  it('an npm session that finds plugin-seen newer than installed_at confirms done (AC-9)', async () => {
    installed();
    // Newer than installed_at even though last_attempt_at (rewritten by a counter bump) is later.
    seen('2026-10-17T11:00:00Z');
    expect(await tick('npm', 's1')).toMatchObject({ state: 'done' });
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(0);
  });
  it('a stale plugin-seen (older than installed_at) still counts the npm session', async () => {
    installed();
    seen('2026-10-17T09:00:00Z');
    expect(await tick('npm', 's1')).toMatchObject({ state: 'installed' });
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(1);
  });
  it('falls back to last_attempt_at for a record with no installed_at', async () => {
    installed({ installed_at: undefined });
    seen('2026-10-17T11:00:00Z'); // older than last_attempt_at 11:30
    expect((await tick('npm', 's1')).state).toBe('installed');
    seen('2026-10-17T12:30:00Z');
    expect((await tick('npm', 's2')).state).toBe('done');
  });
  it('seeds installed_at once on an older record so counter bumps never move it', async () => {
    installed({ installed_at: undefined, last_attempt_at: '2026-10-17T10:00:00Z' });
    await tick('npm', 's1', { now: () => new Date('2026-10-17T11:00:00Z') });
    expect(readMigrationState(home)).toMatchObject({
      installed_at: '2026-10-17T10:00:00Z',
      last_attempt_at: '2026-10-17T11:00:00.000Z',
    });
    // A plugin-seen from after the install but before the bump still counts as fresh.
    seen('2026-10-17T10:30:00Z');
    expect((await tick('npm', 's2', { now: () => new Date('2026-10-17T12:00:00Z') })).state).toBe(
      'done',
    );
  });
  it('the update path persists the seeded installed_at too', () => {
    manifestClaudeCode();
    installed({ installed_at: undefined, last_attempt_at: '2026-10-17T10:00:00Z' });
    maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(readMigrationState(home)?.installed_at).toBe('2026-10-17T10:00:00Z');
  });
  it('treats a record with no timestamps as epoch (any seen confirms)', async () => {
    installed({ installed_at: undefined, last_attempt_at: undefined });
    seen('2026-10-17T11:00:00Z');
    expect((await tick('npm', 's1')).state).toBe('done');
  });
  it('waits the settle before reading plugin-seen on an npm tick only', async () => {
    installed();
    const sleep = vi.fn(async () => {});
    await recordMigrationSession({ source: 'npm', sessionId: 's1' }, { ...baseDeps(), sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    installed();
    sleep.mockClear();
    await recordMigrationSession({ source: 'plugin' }, { ...baseDeps(), sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
  it('uses the real timer when no sleep is injected', async () => {
    installed();
    const r = await recordMigrationSession(
      { source: 'npm', sessionId: 's1' },
      { ...baseDeps(), settleMs: 1 },
    );
    expect(r.state).toBe('installed');
  });
  it('a plugin-seen that lands during the settle is honoured', async () => {
    installed();
    const r = await recordMigrationSession(
      { source: 'npm', sessionId: 's1' },
      { ...baseDeps(), sleep: async () => seen('2026-10-17T11:59:00Z') },
    );
    expect(r.state).toBe('done');
  });
  it('does nothing while the machine lock is held', async () => {
    installed();
    acquireLock(home);
    expect(await tick('npm', 's1')).toEqual({ state: 'installed', reason: 'locked' });
    releaseLock(home);
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(0);
  });
  it('is a no-op for any state other than installed, and for no record', async () => {
    expect(await tick('npm', 's1')).toEqual({
      state: 'pending',
      path: undefined,
      reason: 'nothing-to-record',
    });
    for (const state of ['done', 'failed', 'skipped', 'rolled-back', 'declined'] as const) {
      writeMigrationState(home, { state, attempts: 1, version: '1' });
      expect((await tick('npm', 's1')).reason).toBe('nothing-to-record');
    }
  });
  it('re-reads the state under the lock (another tick finished during the settle)', async () => {
    installed();
    const r = await recordMigrationSession(
      { source: 'npm', sessionId: 's1' },
      {
        ...baseDeps(),
        sleep: async () =>
          writeMigrationState(home, { state: 'done', path: 'settings', attempts: 1, version: '1' }),
      },
    );
    expect(r).toMatchObject({ state: 'done', reason: 'nothing-to-record' });
  });
  it('never throws; an internal error is reported as skipped', async () => {
    installed();
    const r = await recordMigrationSession(
      { source: 'npm' },
      {
        ...baseDeps(),
        sleep: async () => {
          throw new Error('boom');
        },
      },
    );
    expect(r).toEqual({ state: 'skipped', reason: 'error:boom' });
  });
  it('an install records installed_at and a counter bump keeps it', async () => {
    manifestClaudeCode();
    maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(readMigrationState(home)?.installed_at).toBe('2026-10-17T12:00:00.000Z');
    await tick('npm', 's1', { now: () => new Date('2026-10-17T13:00:00Z') });
    expect(readMigrationState(home)).toMatchObject({
      installed_at: '2026-10-17T12:00:00.000Z',
      last_attempt_at: '2026-10-17T13:00:00.000Z',
    });
  });
});

describe('automatic rollback is retryable (B3)', () => {
  function autoRolledBack(extra: Record<string, unknown> = {}): void {
    writeMigrationState(home, {
      state: 'rolled-back',
      reason: 'plugin-never-loaded',
      path: 'settings',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-16T11:00:00Z', // 25h before baseDeps' now
      ...extra,
    });
  }
  it('retries and installs again once the 24h window has passed (AC-6)', () => {
    manifestClaudeCode();
    autoRolledBack();
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
    expect(readMigrationState(home)).toMatchObject({ attempts: 2, npm_sessions_since_install: 0 });
  });
  it('reports retry-not-due inside the 24h window (AC-7)', () => {
    manifestClaudeCode();
    autoRolledBack({ last_attempt_at: '2026-10-17T06:00:00Z' });
    expect(maybeMigrateToPlugin(projectRoot, baseDeps())).toEqual({
      state: 'rolled-back',
      reason: 'retry-not-due',
    });
  });
  it('stops retrying at 5 attempts (AC-7)', () => {
    manifestClaudeCode();
    autoRolledBack({ attempts: 5 });
    expect(maybeMigrateToPlugin(projectRoot, baseDeps()).reason).toBe('retry-not-due');
    expect(retryAllowed(readMigrationState(home), new Date('2026-10-17T12:00:00Z'))).toBe(false);
  });
  it('never retries a manual rollback (INV-6)', () => {
    manifestClaudeCode();
    autoRolledBack({ reason: 'manual' });
    expect(maybeMigrateToPlugin(projectRoot, baseDeps())).toEqual({
      state: 'rolled-back',
      path: 'settings',
      reason: 'manual',
    });
    expect(existsSync(userSettings())).toBe(false);
  });
  it('re-adds the settings keys when a leftover install record is present on retry', () => {
    manifestClaudeCode();
    autoRolledBack();
    writeInstalledRecord();
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
    const settings = JSON.parse(readFileSync(userSettings(), 'utf8'));
    expect(settings.enabledPlugins['paqad@eliyce']).toBe(true);
    expect(settings.extraKnownMarketplaces.eliyce.source.repo).toBe('Eliyce/paqad-ai');
  });
  it('records declined when the user set the plugin false and the record is still present', () => {
    manifestClaudeCode();
    autoRolledBack();
    writeInstalledRecord();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }));
    expect(maybeMigrateToPlugin(projectRoot, baseDeps()).state).toBe('declined');
  });
  it('the automatic rollback uninstalls a listed plugin so the retry starts clean', async () => {
    writeInstalledRecord();
    writeMigrationState(home, {
      state: 'installed',
      path: 'cli',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T10:00:00Z',
      npm_sessions_since_install: 2,
    });
    const runClaudeUninstall = vi.fn();
    const r = await tick('npm', 's3', { runClaudeUninstall });
    expect(r).toMatchObject({ state: 'rolled-back', reason: 'plugin-never-loaded' });
    expect(runClaudeUninstall).toHaveBeenCalledWith(home);
  });
  it('the automatic rollback drops a stale plugin-seen so the retry runs Path A', async () => {
    manifestClaudeCode();
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(pluginSeenPath(home), JSON.stringify({ at: '2026-10-01T00:00:00Z' }));
    writeMigrationState(home, {
      state: 'installed',
      path: 'cli',
      attempts: 1,
      version: '1',
      installed_at: '2026-10-16T10:00:00Z',
      npm_sessions_since_install: 2,
    });
    await tick('npm', 's3', { now: () => new Date('2026-10-16T11:00:00Z') });
    expect(existsSync(pluginSeenPath(home))).toBe(false);
    const runClaudeInstall = vi.fn(() => {
      writeInstalledRecord();
      return { ok: true };
    });
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ claudeVersion: () => '2.1.300', runClaudeInstall }),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'cli' });
    expect(runClaudeInstall).toHaveBeenCalledOnce();
  });
  it('the manual rollback drops plugin-seen too', () => {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(pluginSeenPath(home), JSON.stringify({ at: '2026-10-01T00:00:00Z' }));
    rollbackPlugin(projectRoot, { home, writeInstallModeSettings: () => {} });
    expect(existsSync(pluginSeenPath(home))).toBe(false);
  });
  it('the automatic rollback without an uninstall runner still completes', async () => {
    writeInstalledRecord();
    writeMigrationState(home, {
      state: 'installed',
      path: 'cli',
      attempts: 1,
      version: '1',
      npm_sessions_since_install: 2,
    });
    expect((await tick('npm', 's3')).state).toBe('rolled-back');
  });
});

describe('turning the plugin off after done is declined (B5)', () => {
  function done(): void {
    writeMigrationState(home, {
      state: 'done',
      path: 'cli',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T10:00:00Z',
    });
  }
  function enabled(value: boolean | undefined): void {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      userSettings(),
      JSON.stringify(
        value === undefined
          ? { theme: 'dark' }
          : { theme: 'dark', enabledPlugins: { 'paqad@eliyce': value } },
        null,
        2,
      ),
    );
  }
  it('update records declined/user-disabled and leaves settings byte-identical (AC-13)', () => {
    manifestClaudeCode();
    done();
    enabled(false);
    const before = readFileSync(userSettings(), 'utf8');
    expect(maybeMigrateToPlugin(projectRoot, baseDeps())).toMatchObject({
      state: 'declined',
      reason: 'user-disabled',
    });
    // A later update is settled and still touches nothing (INV-7).
    expect(maybeMigrateToPlugin(projectRoot, baseDeps()).state).toBe('declined');
    expect(readFileSync(userSettings(), 'utf8')).toBe(before);
  });
  it('a session tick records declined/user-disabled (AC-13)', async () => {
    done();
    enabled(false);
    expect(await tick('npm', 's1')).toMatchObject({ state: 'declined', reason: 'user-disabled' });
    expect(readMigrationState(home)).toMatchObject({ state: 'declined', reason: 'user-disabled' });
  });
  it('the doctor line shows declined at once, before any state write (AC-13)', () => {
    done();
    enabled(false);
    expect(describeClaudeInstall(home)).toBe('npm (migration declined: user-disabled)');
    expect(readMigrationState(home)?.state).toBe('done');
  });
  it('done with the plugin on, or unset, or unreadable settings stays done (AC-14)', async () => {
    manifestClaudeCode();
    for (const value of [true, undefined] as const) {
      done();
      enabled(value);
      expect(maybeMigrateToPlugin(projectRoot, baseDeps()).state).toBe('done');
      expect((await tick('npm', 's1')).reason).toBe('nothing-to-record');
      expect(describeClaudeInstall(home)).toBe('plugin (migrated 2026-10-17, via cli)');
    }
    done();
    writeFileSync(userSettings(), '{ broken');
    expect(maybeMigrateToPlugin(projectRoot, baseDeps()).state).toBe('done');
  });
  it('the tick re-checks under the lock (the user turned it back on during the settle)', async () => {
    done();
    enabled(false);
    const r = await recordMigrationSession(
      { source: 'npm', sessionId: 's1' },
      { ...baseDeps(), sleep: async () => enabled(true) },
    );
    expect(r).toMatchObject({ state: 'done', reason: 'nothing-to-record' });
  });
});

describe('maybeMigrateToPlugin — settled + lock', () => {
  it('never retries a done/rolled-back/declined machine', () => {
    for (const state of ['done', 'rolled-back', 'declined'] as const) {
      writeMigrationState(home, { state, attempts: 1, version: '1' });
      manifestClaudeCode();
      expect(maybeMigrateToPlugin(projectRoot, baseDeps()).state).toBe(state);
    }
  });
  it('does not run while another migration holds the lock', () => {
    manifestClaudeCode();
    acquireLock(home);
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.reason).toBe('locked');
    releaseLock(home);
  });
});

describe('rollbackPlugin (Part 6)', () => {
  it('undoes the move, records rolled-back, pins settings, and returns the message', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': true } }));
    writeMigrationState(home, { state: 'installed', path: 'settings', attempts: 1, version: '1' });
    const writeInstallModeSettings = vi.fn();
    const message = rollbackPlugin(projectRoot, { home, writeInstallModeSettings });
    expect(message).toContain('paqad now runs from the npm package');
    expect(readMigrationState(home)).toMatchObject({ state: 'rolled-back', reason: 'manual' });
    expect(
      JSON.parse(readFileSync(userSettings(), 'utf8')).enabledPlugins['paqad@eliyce'],
    ).toBeUndefined();
    expect(writeInstallModeSettings).toHaveBeenCalledWith(projectRoot);
  });
  it('uninstalls on any path when Claude Code lists the plugin, printing the verbatim line (AC-15)', () => {
    for (const path of ['cli', 'settings'] as const) {
      writeMigrationState(home, { state: 'installed', path, attempts: 1, version: '1' });
      writeInstalledRecord();
      const runClaudeUninstall = vi.fn();
      const message = rollbackPlugin(projectRoot, {
        home,
        runClaudeUninstall,
        writeInstallModeSettings: () => {},
      });
      expect(runClaudeUninstall).toHaveBeenCalledWith(home);
      expect(message).toBe(
        'paqad now runs from the npm package in Claude Code again. The plugin was removed.',
      );
      expect(readMigrationState(home)).toMatchObject({ state: 'rolled-back', reason: 'manual' });
    }
  });
  it('does not uninstall when Claude Code does not list the plugin', () => {
    writeMigrationState(home, { state: 'installed', path: 'cli', attempts: 1, version: '1' });
    const runClaudeUninstall = vi.fn();
    rollbackPlugin(projectRoot, { home, runClaudeUninstall, writeInstallModeSettings: () => {} });
    expect(runClaudeUninstall).not.toHaveBeenCalled();
  });
});

describe('runClaudePluginUninstall (B6)', () => {
  it('runs the exact uninstall command and logs the outcome', () => {
    const { exec, calls } = fakeExec({ uninstall: 'ok' });
    const log = vi.fn();
    runClaudePluginUninstall(home, { claudeVersion: () => '2.1.300', exec, log, env: {} });
    expect(calls).toEqual([
      { args: ['plugin', 'uninstall', 'paqad@eliyce', '--scope', 'user'], timeoutMs: 120_000 },
    ]);
    expect(log).toHaveBeenCalledWith('uninstall via cli: ok');
  });
  it('runs nothing when there is no claude on PATH (AC-16)', () => {
    const { exec, calls } = fakeExec({});
    const log = vi.fn();
    runClaudePluginUninstall(home, { claudeVersion: () => null, exec, log });
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith('uninstall skipped: no claude on PATH');
  });
  it('logs a failing uninstall and never throws (AC-16)', () => {
    const { exec } = fakeExec({ uninstall: 'exit' });
    runClaudePluginUninstall(home, { claudeVersion: () => '2.1.300', exec });
    expect(readFileSync(migrationLogPath(home), 'utf8')).toContain('uninstall via cli: exit');
    const throwing: ClaudeExec = () => {
      throw new Error('spawn blew up');
    };
    expect(() =>
      runClaudePluginUninstall(home, { claudeVersion: () => '2.1.300', exec: throwing }),
    ).not.toThrow();
    expect(readFileSync(migrationLogPath(home), 'utf8')).toContain('error (spawn blew up)');
  });
  it('the default exec reports a missing claude binary instead of throwing', () => {
    // An empty PATH means the real spawn cannot find claude: 'error' (posix) or 'exit' (cmd.exe).
    const log = vi.fn();
    runClaudePluginUninstall(home, { claudeVersion: () => '2.1.300', env: { PATH: '' }, log });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^uninstall via cli: (error|exit)$/));
  });
  it('a failing uninstall still lets the rollback complete', () => {
    writeInstalledRecord();
    const { exec } = fakeExec({ uninstall: 'timeout' });
    const message = rollbackPlugin(projectRoot, {
      home,
      runClaudeUninstall: (h) => runClaudePluginUninstall(h, { claudeVersion: () => '1', exec }),
      writeInstallModeSettings: () => {},
    });
    expect(message).toContain('The plugin was removed.');
    expect(readMigrationState(home)?.state).toBe('rolled-back');
  });
});

describe('coverage: edge branches', () => {
  it('writeMigrationState fails open when the state dir cannot be created', () => {
    writeFileSync(join(home, '.paqad-ai'), 'x'); // a FILE where the dir must go → mkdir throws
    expect(() =>
      writeMigrationState(home, { state: 'installed', attempts: 1, version: '1' }),
    ).not.toThrow();
  });
  it('readPluginSeen returns null on malformed json', () => {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(pluginSeenPath(home), 'nope');
    expect(isPluginPresent(home)).toBe(false);
  });
  it('projectTargetsClaudeCode handles a manifest with no generated_artifacts', () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ adapter: 'codex-cli' }),
    );
    expect(projectTargetsClaudeCode(projectRoot)).toBe(false);
  });
  it('retryAllowed is true for an unsettled record with no last_attempt_at', () => {
    expect(
      retryAllowed(
        { state: 'failed', attempts: 1, version: '1' },
        new Date('2026-10-17T12:00:00Z'),
      ),
    ).toBe(true);
  });
  it('skips in CI via PAQAD_HEADLESS', () => {
    manifestClaudeCode();
    expect(
      maybeMigrateToPlugin(
        projectRoot,
        baseDeps({ env: { PAQAD_PLUGIN_MIGRATION: 'on', PAQAD_HEADLESS: '1' } }),
      ).reason,
    ).toBe('ci-or-headless');
  });
  it('returns retry-not-due when a recent failed attempt is inside the window', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'failed',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T11:30:00Z',
    });
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.reason).toBe('retry-not-due');
  });
  it('jumps to installed when a NON-synced plugin is already present', () => {
    manifestClaudeCode();
    const p = join(home, '.claude', 'plugins');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'installed_plugins.json'), JSON.stringify({ 'paqad@eliyce': {} }));
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
  });
  it('wraps an unexpected internal error as skipped', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({
        now: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(r.state).toBe('skipped');
    expect(r.reason).toContain('error:');
  });
  it('records failed when Path B cannot read the user settings during install', () => {
    manifestClaudeCode();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), '{ broken');
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.state).toBe('failed');
  });
  it('increments attempts from a prior pending record on install', () => {
    manifestClaudeCode();
    writeMigrationState(home, { state: 'pending', attempts: 1, version: '1' });
    maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(readMigrationState(home)?.attempts).toBe(2);
  });
  it('Path A failure with no reason still falls back to Path B', () => {
    manifestClaudeCode();
    const r = maybeMigrateToPlugin(
      projectRoot,
      baseDeps({ claudeVersion: () => '2.1.300', runClaudeInstall: () => ({ ok: false }) }),
    );
    expect(r).toMatchObject({ state: 'installed', path: 'settings' });
  });
  it('the update confirm treats a missing install timestamp as epoch (still confirms a newer seen)', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'installed',
      path: 'settings',
      attempts: 1,
      version: '1',
      npm_sessions_since_install: 0,
    });
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(pluginSeenPath(home), JSON.stringify({ at: '2026-10-17T11:00:00Z' }));
    expect(maybeMigrateToPlugin(projectRoot, baseDeps()).state).toBe('done');
  });
  it('the update confirm marks done+synced when the seen plugin is synced', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'installed',
      path: 'settings',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T10:00:00Z',
    });
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(
      pluginSeenPath(home),
      JSON.stringify({ at: '2026-10-17T11:00:00Z', root: '/u/.claude/plugins/synced/paqad' }),
    );
    expect(maybeMigrateToPlugin(projectRoot, baseDeps())).toMatchObject({
      state: 'done',
      path: 'synced',
    });
  });
  it('rollbackPlugin works with no prior record and the default settings writer', () => {
    const message = rollbackPlugin(projectRoot, { home });
    expect(message).toContain('paqad now runs from the npm package');
    expect(readMigrationState(home)?.state).toBe('rolled-back');
    // The default writer pins claude_install_mode=settings in the project's local .config.
    expect(readFileSync(join(projectRoot, '.paqad/.config'), 'utf8')).toContain(
      'claude_install_mode=settings',
    );
  });
  it('describeClaudeInstall reports npm for a pending record', () => {
    writeMigrationState(home, { state: 'pending', attempts: 0, version: '1' });
    expect(describeClaudeInstall(home)).toBe('npm');
  });
  it('describeClaudeInstall uses "unknown" when a done record has no timestamp', () => {
    writeMigrationState(home, { state: 'done', path: 'settings', attempts: 1, version: '1' });
    expect(describeClaudeInstall(home)).toBe('plugin (migrated unknown, via settings)');
  });
  it('describeClaudeInstall defaults the path to settings when a done record has none', () => {
    writeMigrationState(home, {
      state: 'done',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T10:00:00Z',
    });
    expect(describeClaudeInstall(home)).toBe('plugin (migrated 2026-10-17, via settings)');
  });
  it('defaultManagedSettingsPaths returns the per-OS files', () => {
    expect(defaultManagedSettingsPaths('darwin')[0]).toContain('ClaudeCode');
    expect(defaultManagedSettingsPaths('linux')[0]).toContain('claude-code');
    expect(defaultManagedSettingsPaths('win32')[0]).toContain('ClaudeCode');
  });
  it('resolves its own defaults (home, managed paths, logger) when no deps are passed', () => {
    // HOME is sandboxed by tests/shared/isolate-home.ts, so the real defaults are safe here.
    const r = maybeMigrateToPlugin(projectRoot);
    expect(r.state).toBe('skipped'); // migration off by default
  });
  it('uses the default file logger when no log dep is given', () => {
    manifestClaudeCode();
    const deps = baseDeps();
    delete deps.log;
    maybeMigrateToPlugin(projectRoot, deps);
    expect(existsSync(migrationLogPath(home))).toBe(true);
  });

  it('versionAtLeast treats a non-numeric segment as 0', () => {
    expect(versionAtLeast('2.x.0', '2.0.0')).toBe(true); // both parse to [2,0,0]
    expect(versionAtLeast('2.0.0', '2.x.9')).toBe(false); // [2,0,0] < [2,0,9]
  });
  it('versionAtLeast handles different-length versions', () => {
    expect(versionAtLeast('2.1', '2.1.0')).toBe(true); // missing segment → 0
    expect(versionAtLeast('2.1.0', '2.1')).toBe(true);
  });
  it('installViaSettings records user-settings-write-failed when the dir cannot be created', () => {
    writeFileSync(join(home, '.claude'), 'x'); // a FILE where .claude/ must go → mkdir throws
    expect(installViaSettings(home)).toEqual({
      state: 'failed',
      reason: 'user-settings-write-failed',
    });
  });
  it('managed-policy skip increments attempts from a prior record', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'skipped',
      reason: 'managed-policy',
      attempts: 2,
      version: '1',
    });
    const policy = join(home, 'managed-settings.json');
    writeFileSync(policy, JSON.stringify({ disableAllHooks: true }));
    // Make the prior stale enough that the 7-day recheck allows another attempt.
    writeMigrationState(home, {
      state: 'skipped',
      reason: 'managed-policy',
      attempts: 2,
      version: '1',
      last_attempt_at: '2026-10-01T00:00:00Z',
    });
    maybeMigrateToPlugin(projectRoot, baseDeps({ managedSettingsPaths: [policy] }));
    expect(readMigrationState(home)?.attempts).toBe(3);
  });
  it('returns locked (keeping the prior state) when another migration holds the lock', () => {
    manifestClaudeCode();
    writeMigrationState(home, { state: 'failed', attempts: 1, version: '1' });
    acquireLock(home);
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r).toMatchObject({ state: 'failed', reason: 'locked' });
    releaseLock(home);
  });
  it('rollbackPlugin uses the sandboxed home default when none is passed', () => {
    // No home dep → homedir() (sandboxed by isolate-home.ts).
    const message = rollbackPlugin(projectRoot, { writeInstallModeSettings: () => {} });
    expect(message).toContain('paqad now runs from the npm package');
  });
  it('describeClaudeInstall uses n/a when an in-flight state has no reason', () => {
    writeMigrationState(home, { state: 'failed', attempts: 1, version: '1' });
    expect(describeClaudeInstall(home)).toBe('npm (migration failed: n/a)');
  });
});

describe('describeClaudeInstall (Part 7)', () => {
  it('reports npm when nothing has happened', () => {
    expect(describeClaudeInstall(home)).toBe('npm');
  });
  it('reports a migrated plugin with date and path', () => {
    writeMigrationState(home, {
      state: 'done',
      path: 'cli',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T10:00:00Z',
    });
    expect(describeClaudeInstall(home)).toBe('plugin (migrated 2026-10-17, via cli)');
  });
  it('reports the synced route', () => {
    writeMigrationState(home, { state: 'done', path: 'synced', attempts: 1, version: '1' });
    expect(describeClaudeInstall(home)).toBe('plugin (synced from claude.ai)');
  });
  it('reports an in-flight / undone migration state', () => {
    writeMigrationState(home, {
      state: 'rolled-back',
      reason: 'manual',
      attempts: 1,
      version: '1',
    });
    expect(describeClaudeInstall(home)).toBe('npm (migration rolled-back: manual)');
  });
});
