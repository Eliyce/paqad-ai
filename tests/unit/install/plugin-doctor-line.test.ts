import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeFrameworkLink } from '@/health/plugin-install.js';
import {
  type ClaudeInstallLineOptions,
  describeClaudeInstall,
  maybeMigrateToPlugin,
  INSTALL_PLUGIN_FIX,
  MIGRATION_WAITING_DETAIL,
  PLUGIN_BLOCKED_FIX,
  pluginSeenPath,
  readInstalledPluginVersion,
  UNKNOWN_PLUGIN_FORMAT_DETAIL,
  WAITING_FOR_LOAD_FIX,
  rollbackPlugin,
  runClaudePluginUninstall,
  writeMigrationState,
} from '@/install/plugin-migration.js';

let home: string;
let projectRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'paqad-doctor-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'paqad-doctor-proj-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

const NPM_CLI = '/usr/lib/node_modules/paqad-ai/dist/cli/index.js';
const PLUGIN_CLI = '/u/.claude/plugins/data/paqad-eliyce/runtime/dist/cli/index.js';

function line(options: ClaudeInstallLineOptions = {}, env: NodeJS.ProcessEnv = {}) {
  return describeClaudeInstall(home, undefined, env, {
    managedSettingsPaths: [],
    cliEntry: NPM_CLI,
    version: '1.99.4',
    ...options,
  });
}

function writePolicy(policy: unknown): string {
  const path = join(home, 'fake-managed', 'managed-settings.json');
  mkdirSync(join(home, 'fake-managed'), { recursive: true });
  writeFileSync(path, JSON.stringify(policy));
  return path;
}

function writeInstalledPlugins(value: unknown): void {
  const dir = join(home, '.claude', 'plugins');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'installed_plugins.json'), JSON.stringify(value));
}

function pluginRoot(version: string): string {
  const root = join(home, '.claude', 'plugins', 'cache', 'eliyce', 'paqad', version);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'paqad-ai', version }));
  return root;
}

function installedAt(version: string): void {
  writeInstalledPlugins({
    version: 2,
    plugins: { 'paqad@eliyce': [{ scope: 'user', installPath: pluginRoot(version) }] },
  });
}

describe('the Claude Code install line under a managed policy', () => {
  it('warns with the IT fix when allowManagedHooksOnly is set', () => {
    expect(line({ managedSettingsPaths: [writePolicy({ allowManagedHooksOnly: true })] })).toEqual({
      detail: "A managed policy blocks paqad's hooks, so paqad's checks don't run here.",
      level: 'warning',
      remediation: 'Ask IT to deploy the paqad plugin as a managed plugin, or allow its hooks.',
    });
  });
  it('gives the same warning when disableAllHooks is set', () => {
    const result = line({ managedSettingsPaths: [writePolicy({ disableAllHooks: true })] });
    expect(result.level).toBe('warning');
    expect(result.detail).toBe(
      "A managed policy blocks paqad's hooks, so paqad's checks don't run here.",
    );
  });
  it('AC-30: warns that the plugin is blocked when enabledPlugins is false or the marketplace list is strict', () => {
    for (const policy of [
      { enabledPlugins: { 'paqad@eliyce': false } },
      { strictKnownMarketplaces: [{ repo: 'other/repo' }] },
    ]) {
      expect(line({ managedSettingsPaths: [writePolicy(policy)] })).toEqual({
        detail: 'plugin blocked by policy; paqad stays on npm',
        level: 'warning',
        remediation: PLUGIN_BLOCKED_FIX,
      });
    }
  });
});

describe('the Claude Code install line says what is installed', () => {
  it('reads plugin when the plugin is installed and enabled with no npm copy, whatever the record says', () => {
    writeMigrationState(home, {
      state: 'skipped',
      reason: 'migration-off',
      attempts: 0,
      version: '1',
    });
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    expect(line({ cliEntry: PLUGIN_CLI })).toEqual({ detail: 'plugin', level: 'pass' });
  });
  it('shows both versions and passes when they match', () => {
    installedAt('1.99.4');
    expect(line({ cliEntry: PLUGIN_CLI })).toEqual({
      detail: 'plugin; plugin v1.99.4, paqad-ai v1.99.4',
      level: 'pass',
    });
  });
  it('warns and shows both versions when the plugin version differs from paqad-ai', () => {
    installedAt('1.95.1');
    const result = line({ cliEntry: PLUGIN_CLI });
    expect(result.detail).toBe('plugin; plugin v1.95.1, paqad-ai v1.99.4');
    expect(result.level).toBe('warning');
    expect(result.remediation).toContain('claude plugin update paqad@eliyce');
  });
  it('adds the versions to a done record when an npm copy is present', () => {
    installedAt('1.95.1');
    writeMigrationState(home, {
      state: 'done',
      path: 'bundled-cli',
      attempts: 1,
      version: '1',
      last_attempt_at: '2026-10-17T12:00:00Z',
    });
    expect(line().detail).toBe(
      'plugin (migrated 2026-10-17, via bundled-cli); plugin v1.95.1, paqad-ai v1.99.4',
    );
  });
  it('counts an npm framework link as an npm copy', () => {
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    const npmRuntime = join(home, 'lib', 'node_modules', 'paqad-ai', 'runtime');
    mkdirSync(npmRuntime, { recursive: true });
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    symlinkSync(npmRuntime, join(home, '.paqad-ai', 'current'), 'junction');
    expect(line({ cliEntry: PLUGIN_CLI }).detail).toBe('npm');
  });
  it('reads plugin (synced from claude.ai) for a Desktop rpm root', () => {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(
      pluginSeenPath(home),
      JSON.stringify({
        at: '2026-10-17T12:00:00Z',
        root: '/Users/u/Library/Application Support/Claude/local-agent-mode-sessions/a/b/rpm/plugin_01',
      }),
    );
    expect(line().detail).toBe('plugin (synced from claude.ai)');
  });
  it('waits for the plugin to load once Claude Code installed it but it has not run yet', () => {
    writeMigrationState(home, {
      state: 'installed',
      path: 'cli',
      attempts: 1,
      version: '1',
      installed_at: '2026-10-17T12:00:00Z',
    });
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    const waitingLine = line();
    expect(waitingLine.level).toBe('warning');
    expect(waitingLine.remediation).toBe(WAITING_FOR_LOAD_FIX);
    const waiting = waitingLine.detail;
    expect(waiting).toBe(
      'npm (moving to the plugin: waiting for the plugin to load in a new session)',
    );
    expect(waiting).not.toContain('n/a');
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(
      pluginSeenPath(home),
      JSON.stringify({ at: '2026-10-17T13:00:00Z', root: '/u/.claude/plugins/cache/x' }),
    );
    expect(line().detail).toBe('npm (migration installed)');
  });
  it('shows a stored Path A failure reason until the state moves on', () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
    );
    maybeMigrateToPlugin(projectRoot, {
      env: { PAQAD_PLUGIN_MIGRATION: 'on' },
      home,
      now: () => new Date('2026-10-17T12:00:00Z'),
      claudeVersion: () => '2.1.301',
      runClaudeInstall: () => ({ ok: false, reason: 'cli-install-failed:exit' }),
      managedSettingsPaths: [],
      log: () => {},
    });
    expect(line().detail).toBe('npm (migration failed: path-a-failed:cli-install-failed:exit)');
  });
  it('shows the no-claude-cli, claude-too-old and bundled-cli-failed reasons', () => {
    for (const reason of [
      'no-claude-cli',
      'claude-too-old:2.1.200',
      'bundled-cli-failed:cli-install-failed:exit',
    ]) {
      writeMigrationState(home, { state: 'skipped', reason, attempts: 1, version: '1' });
      expect(line().detail).toBe(`npm (migration skipped: ${reason})`);
    }
  });
});

describe('the plugin version is read from the plugin root', () => {
  it('reads installPath package.json, then the record version, then the runtime copy version file', () => {
    expect(readInstalledPluginVersion(home, {})).toBeNull();
    installedAt('1.98.0');
    expect(readInstalledPluginVersion(home, {})).toBe('1.98.0');
    writeInstalledPlugins({
      plugins: { 'paqad@eliyce': [{ installPath: join(home, 'gone'), version: '1.97.0' }] },
    });
    expect(readInstalledPluginVersion(home, {})).toBe('1.97.0');
    writeInstalledPlugins({ 'paqad@eliyce': { version: '' } });
    const copy = join(home, '.claude', 'plugins', 'data', 'paqad-eliyce', 'runtime');
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, 'version'), '1.96.0\n');
    expect(readInstalledPluginVersion(home, {})).toBe('1.96.0');
    const data = join(home, 'data');
    mkdirSync(join(data, 'runtime'), { recursive: true });
    writeFileSync(join(data, 'runtime', 'version'), '1.95.0\n');
    expect(readInstalledPluginVersion(home, { CLAUDE_PLUGIN_DATA: data })).toBe('1.95.0');
  });
  it('reads the install record and the runtime copy from CLAUDE_CONFIG_DIR when it is set', () => {
    const configDir = join(home, 'claude-config');
    const env = { CLAUDE_CONFIG_DIR: configDir };
    installedAt('1.98.0');
    expect(readInstalledPluginVersion(home, env)).toBeNull();
    const copy = join(configDir, 'plugins', 'data', 'paqad-eliyce', 'runtime');
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, 'version'), '1.97.5\n');
    expect(readInstalledPluginVersion(home, env)).toBe('1.97.5');
    mkdirSync(join(configDir, 'plugins'), { recursive: true });
    writeFileSync(
      join(configDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ 'paqad@eliyce': { installPath: pluginRoot('1.99.4') } }),
    );
    expect(readInstalledPluginVersion(home, env)).toBe('1.99.4');
    expect(line({ cliEntry: PLUGIN_CLI }, env).detail).toBe(
      'plugin; plugin v1.99.4, paqad-ai v1.99.4',
    );
  });
  it('ignores an unreadable or oddly shaped install record', () => {
    const dir = join(home, '.claude', 'plugins');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'installed_plugins.json'), '"text"');
    expect(readInstalledPluginVersion(home, {})).toBeNull();
    writeFileSync(join(dir, 'installed_plugins.json'), '{ broken');
    expect(readInstalledPluginVersion(home, {})).toBeNull();
  });
  it('the framework link reads the runtime copy version file, never unknown', () => {
    const copy = join(home, 'data', 'runtime');
    mkdirSync(join(copy, 'runtime'), { recursive: true });
    writeFileSync(join(copy, 'version'), '1.99.4\n');
    const link = join(home, 'current');
    symlinkSync(join(copy, 'runtime'), link, 'junction');
    expect(describeFrameworkLink({ PAQAD_FRAMEWORK_HOME: link }).version).toBe('1.99.4');
    writeFileSync(join(copy, 'version'), '\n');
    expect(describeFrameworkLink({ PAQAD_FRAMEWORK_HOME: link }).version).toBeNull();
  });
});

describe('plugin rollback with no claude to run', () => {
  it('prints the exact manual line and turns the plugin off', () => {
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    const message = rollbackPlugin(projectRoot, {
      home,
      runClaudeUninstall: (h) =>
        runClaudePluginUninstall(h, {
          claudeVersion: () => null,
          bundledClaude: () => null,
          log: () => {},
        }),
      writeInstallModeSettings: () => {},
    });
    expect(message).toBe(
      'The plugin is turned off. Run `claude plugin uninstall paqad@eliyce` to remove it.',
    );
  });
  it('uninstalls through the bundled claude when none is on PATH', () => {
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    const calls: string[][] = [];
    const lines: string[] = [];
    const message = rollbackPlugin(projectRoot, {
      home,
      runClaudeUninstall: (h) =>
        runClaudePluginUninstall(h, {
          claudeVersion: () => null,
          bundledClaude: () => '/fake/claude',
          exec: (args) => {
            calls.push([...args]);
            return 'ok';
          },
          log: (m) => lines.push(m),
        }),
      writeInstallModeSettings: () => {},
    });
    expect(calls).toEqual([['plugin', 'uninstall', 'paqad@eliyce', '--scope', 'user']]);
    expect(lines).toEqual(['uninstall via bundled-cli: ok']);
    expect(message).toBe(
      'paqad now runs from the npm package in Claude Code again. The plugin was removed.',
    );
  });
  it('says the plugin could not be turned off when the settings cannot be read, and leaves them alone', () => {
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{ broken');
    expect(
      rollbackPlugin(projectRoot, {
        home,
        runClaudeUninstall: () => 'no-claude',
        writeInstallModeSettings: () => {},
      }),
    ).toBe(
      'paqad could not turn the plugin off. Run `claude plugin uninstall paqad@eliyce` to remove it.',
    );
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe('{ broken');
  });
  it('says the plugin could not be turned off when the settings are not an object', () => {
    writeInstalledPlugins({ 'paqad@eliyce': {} });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '"text"');
    expect(
      rollbackPlugin(projectRoot, {
        home,
        runClaudeUninstall: () => 'no-claude',
        writeInstallModeSettings: () => {},
      }),
    ).toContain('paqad could not turn the plugin off.');
  });
});

describe('AC-31: the doctor reads the plugin version entry that applies to this repo', () => {
  function entryFor(version: string, scope: string, projectPath?: string) {
    return { scope, installPath: pluginRoot(version), ...(projectPath ? { projectPath } : {}) };
  }

  it('AC-31: passes on this repo current project entry and ignores another repo older entry', () => {
    const other = mkdtempSync(join(tmpdir(), 'paqad-doctor-other-'));
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'paqad@eliyce': [
          entryFor('1.90.0', 'project', other),
          entryFor('1.99.4', 'local', projectRoot),
        ],
      },
    });
    expect(readInstalledPluginVersion(home, {}, projectRoot)).toBe('1.99.4');
    const result = describeClaudeInstall(
      home,
      projectRoot,
      {},
      {
        managedSettingsPaths: [],
        cliEntry: PLUGIN_CLI,
        version: '1.99.4',
      },
    );
    expect(result.level).toBe('pass');
    expect(result.detail).toContain('plugin v1.99.4');
    rmSync(other, { recursive: true, force: true });
  });

  it('AC-31: shows the user entry version when only a user entry exists', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: { 'paqad@eliyce': [entryFor('1.98.0', 'user')] },
    });
    expect(readInstalledPluginVersion(home, {}, projectRoot)).toBe('1.98.0');
  });

  it('AC-31: shows no version when only another repo has an entry', () => {
    const other = mkdtempSync(join(tmpdir(), 'paqad-doctor-other-'));
    writeInstalledPlugins({
      version: 2,
      plugins: { 'paqad@eliyce': [entryFor('1.90.0', 'project', other)] },
    });
    const copy = join(home, '.claude', 'plugins', 'data', 'paqad-eliyce', 'runtime');
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, 'version'), '1.90.0\n');
    expect(readInstalledPluginVersion(home, {}, projectRoot)).toBeNull();
    rmSync(other, { recursive: true, force: true });
  });
});

describe('AC-30: every plugin-not-loaded state is a warning with a remediation', () => {
  it('AC-30: migration installed but Claude Code has not installed the plugin warns', () => {
    writeMigrationState(home, { state: 'installed', path: 'cli', attempts: 1, version: '1' });
    expect(line()).toEqual({
      detail: MIGRATION_WAITING_DETAIL,
      level: 'warning',
      remediation: INSTALL_PLUGIN_FIX,
    });
  });
});

describe('AC-32: an unknown installed_plugins.json shape never throws', () => {
  it('AC-32: names an unknown plugin file format instead of plugin not loaded', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'paqad@eliyce': true } }),
    );
    for (const shape of ['not json', JSON.stringify({ version: 3, plugins: [] }), '[]']) {
      mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
      writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), shape);
      const result = describeClaudeInstall(
        home,
        projectRoot,
        {},
        {
          managedSettingsPaths: [],
          cliEntry: NPM_CLI,
          version: '1.99.4',
        },
      );
      expect(result.detail).toBe(UNKNOWN_PLUGIN_FORMAT_DETAIL);
      expect(result.level).toBe('warning');
      expect(() => readInstalledPluginVersion(home, {}, projectRoot)).not.toThrow();
    }
  });
});
