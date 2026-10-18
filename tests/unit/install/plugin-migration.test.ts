import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  migrationLogPath,
  migrationStatePath,
  projectTargetsClaudeCode,
  pluginSeenPath,
  readMigrationState,
  releaseLock,
  retryAllowed,
  rollbackPlugin,
  runClaudePluginInstall,
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
            attempts: 5,
            version: '1',
            last_attempt_at: '2026-10-17T11:59:00Z',
          },
          now,
        ),
      ).toBe(true);
    }
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

describe('config skips do not throttle a later opt-in (B7)', () => {
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
  it('rolls back after 3 npm sessions with no plugin', () => {
    manifestClaudeCode();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ enabledPlugins: { 'paqad@eliyce': true } }));
    installed({ npm_sessions_since_install: 2 });
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.state).toBe('rolled-back');
    expect(r.reason).toBe('plugin-never-loaded');
    const after = JSON.parse(readFileSync(userSettings(), 'utf8'));
    expect(after.enabledPlugins['paqad@eliyce']).toBeUndefined();
  });
  it('counts a session without rolling back before the threshold', () => {
    manifestClaudeCode();
    installed({ npm_sessions_since_install: 0 });
    const r = maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(r.state).toBe('installed');
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(1);
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
  it('calls the claude uninstall for a cli-path machine', () => {
    writeMigrationState(home, { state: 'installed', path: 'cli', attempts: 1, version: '1' });
    const runClaudeUninstall = vi.fn();
    rollbackPlugin(projectRoot, { home, runClaudeUninstall, writeInstallModeSettings: () => {} });
    expect(runClaudeUninstall).toHaveBeenCalledOnce();
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
  it('confirmOrUndo treats a missing install timestamp as epoch (still confirms a newer seen)', () => {
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
  it('confirmOrUndo marks done+synced when the seen plugin is synced', () => {
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
  it('confirmOrUndo counts a session when npm_sessions_since_install is undefined', () => {
    manifestClaudeCode();
    writeMigrationState(home, {
      state: 'installed',
      path: 'settings',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T10:00:00Z',
    });
    maybeMigrateToPlugin(projectRoot, baseDeps());
    expect(readMigrationState(home)?.npm_sessions_since_install).toBe(1);
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
