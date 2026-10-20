import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyManagedPolicy,
  findBundledClaude,
  isSyncedRoot,
  maybeMigrateToPlugin,
  type MigrationDeps,
  pluginSeenPath,
  readMigrationState,
  runClaudeInstallWith,
} from '@/install/plugin-migration.js';

let home: string;
let projectRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'paqad-move-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'paqad-move-proj-'));
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
  );
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function deps(over: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    env: { PAQAD_PLUGIN_MIGRATION: 'on' },
    home,
    now: () => new Date('2026-10-17T12:00:00Z'),
    version: '1.99.4',
    claudeVersion: () => null,
    runClaudeInstall: () => ({ ok: true }),
    bundledClaude: () => null,
    managedSettingsPaths: [],
    log: () => {},
    ...over,
  };
}

function userSettings(): string {
  return join(home, '.claude', 'settings.json');
}

function writeUserSettings(value: unknown): string {
  mkdirSync(join(home, '.claude'), { recursive: true });
  const text = `${JSON.stringify(value, null, 4)}\n`;
  writeFileSync(userSettings(), text);
  return text;
}

function writePolicy(policy: unknown): string {
  const path = join(home, 'fake-managed', 'managed-settings.json');
  mkdirSync(join(home, 'fake-managed'), { recursive: true });
  writeFileSync(path, JSON.stringify(policy));
  return path;
}

function writeSeen(root: string): void {
  mkdirSync(join(home, '.paqad-ai'), { recursive: true });
  writeFileSync(pluginSeenPath(home), JSON.stringify({ version: '1', at: 'now', root }));
}

function desktopRoot(): string {
  return join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
}

function desktopBinary(version: string, hash: string, executable = true): string {
  const dir = join(desktopRoot(), version, hash, 'claude.app', 'Contents', 'MacOS');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'claude');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, executable ? 0o755 : 0o644);
  return bin;
}

describe('classifyManagedPolicy', () => {
  it('names hooks-blocked for allowManagedHooksOnly and disableAllHooks', () => {
    expect(classifyManagedPolicy([writePolicy({ allowManagedHooksOnly: true })])).toBe(
      'hooks-blocked',
    );
    expect(classifyManagedPolicy([writePolicy({ disableAllHooks: true })])).toBe('hooks-blocked');
  });
  it('names plugin-blocked for a disabled plugin, a strict list without paqad, or a blocked marketplace', () => {
    expect(
      classifyManagedPolicy([writePolicy({ enabledPlugins: { 'paqad@eliyce': false } })]),
    ).toBe('plugin-blocked');
    expect(classifyManagedPolicy([writePolicy({ strictKnownMarketplaces: ['other/repo'] })])).toBe(
      'plugin-blocked',
    );
    expect(
      classifyManagedPolicy([writePolicy({ blockedMarketplaces: [{ repo: 'Eliyce/paqad-ai' }] })]),
    ).toBe('plugin-blocked');
  });
  it('lets a later hooks block win over an earlier plugin block', () => {
    const first = writePolicy({ enabledPlugins: { 'paqad@eliyce': false } });
    const second = join(home, 'fake-managed', 'second.json');
    writeFileSync(second, JSON.stringify({ disableAllHooks: true }));
    expect(classifyManagedPolicy([first, second])).toBe('hooks-blocked');
  });
  it('is null for no files, an unreadable file, a non-object file or an open policy', () => {
    expect(classifyManagedPolicy([])).toBeNull();
    expect(classifyManagedPolicy([join(home, 'missing.json')])).toBeNull();
    const list = join(home, 'list.json');
    writeFileSync(list, 'null');
    expect(classifyManagedPolicy([list])).toBeNull();
    expect(classifyManagedPolicy([writePolicy({ enabledPlugins: { other: false } })])).toBeNull();
  });
});

describe('the managed policy is checked before a present plugin', () => {
  it('records skipped/managed-policy with a plugin-seen present and leaves user settings byte-identical', () => {
    writeSeen('/u/.claude/plugins/cache/eliyce/paqad/1.0.0');
    const before = writeUserSettings({ theme: 'dark' });
    const runClaudeInstall = vi.fn(() => ({ ok: true }));
    const result = maybeMigrateToPlugin(
      projectRoot,
      deps({
        managedSettingsPaths: [writePolicy({ enabledPlugins: { 'paqad@eliyce': false } })],
        claudeVersion: () => '2.1.300',
        runClaudeInstall,
      }),
    );
    expect(result).toMatchObject({ state: 'skipped', reason: 'managed-policy' });
    expect(readMigrationState(home)).toMatchObject({ state: 'skipped', reason: 'managed-policy' });
    expect(readFileSync(userSettings(), 'utf8')).toBe(before);
    expect(runClaudeInstall).not.toHaveBeenCalled();
  });
  it('a hooks block also stops the move with nothing written', () => {
    writeSeen('/u/.claude/plugins/synced/paqad');
    const result = maybeMigrateToPlugin(
      projectRoot,
      deps({ managedSettingsPaths: [writePolicy({ allowManagedHooksOnly: true })] }),
    );
    expect(result.reason).toBe('managed-policy');
    expect(existsSync(userSettings())).toBe(false);
  });
});

describe('a Desktop app copy synced from claude.ai', () => {
  const macRoot =
    '/Users/u/Library/Application Support/Claude/local-agent-mode-sessions/abc/def/rpm/plugin_01ABC';
  const winRoot =
    'C:\\Users\\u\\AppData\\Roaming\\Claude\\local-agent-mode-sessions\\abc\\def\\rpm\\plugin_01ABC';

  it('isSyncedRoot matches the macOS and Windows rpm roots', () => {
    expect(isSyncedRoot(macRoot)).toBe(true);
    expect(isSyncedRoot(winRoot)).toBe(true);
    expect(isSyncedRoot('C:\\Users\\u\\.claude\\plugins\\synced\\paqad')).toBe(true);
    expect(isSyncedRoot('/Users/u/Library/Application Support/Claude/rpm/plugin_01ABC')).toBe(
      false,
    );
    expect(isSyncedRoot('/x/Claude/local-agent-mode-sessions/abc/plugin_01ABC')).toBe(false);
  });

  for (const [label, root] of [
    ['macOS', macRoot],
    ['Windows', winRoot],
  ] as const) {
    it(`records done/synced for the ${label} root with no install and no user settings write`, () => {
      writeSeen(root);
      const runClaudeInstall = vi.fn(() => ({ ok: true }));
      const result = maybeMigrateToPlugin(
        projectRoot,
        deps({ claudeVersion: () => '2.1.300', runClaudeInstall }),
      );
      expect(result).toMatchObject({ state: 'done', path: 'synced' });
      expect(runClaudeInstall).not.toHaveBeenCalled();
      expect(existsSync(userSettings())).toBe(false);
    });
  }
});

describe('Path B: the Desktop app bundled claude', () => {
  it('findBundledClaude picks the highest version holding an executable binary', () => {
    desktopBinary('2.1.295', '9d6405864fdc');
    const newest = desktopBinary('2.1.299', '4fa9694b7975');
    desktopBinary('2.1.30', 'lower');
    expect(findBundledClaude(home, 'darwin')).toBe(newest);
  });
  it('falls back to the next version when the highest has no executable binary', () => {
    const older = desktopBinary('2.1.295', '9d6405864fdc');
    desktopBinary('2.1.299', '4fa9694b7975', false);
    mkdirSync(join(desktopRoot(), '2.1.300', 'empty'), { recursive: true });
    writeFileSync(join(desktopRoot(), 'auto-update-candidate.json'), '{}');
    writeFileSync(join(desktopRoot(), '2.1.301'), '');
    expect(findBundledClaude(home, 'darwin')).toBe(older);
  });
  it('finds claude.exe under the Windows app data folder', () => {
    const appData = join(home, 'AppData', 'Roaming');
    const dir = join(appData, 'Claude', 'claude-code', '2.1.299', 'abc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'claude.exe'), '');
    expect(findBundledClaude(home, 'win32', { APPDATA: appData })).toBe(join(dir, 'claude.exe'));
    expect(findBundledClaude(home, 'win32', {})).toBe(join(dir, 'claude.exe'));
  });
  it('is null on Linux and when no Desktop tree exists', () => {
    expect(findBundledClaude(home, 'linux')).toBeNull();
    expect(findBundledClaude(home, 'darwin')).toBeNull();
  });

  it('with no claude on PATH runs the highest bundled claude and records installed/bundled-cli', () => {
    desktopBinary('2.1.295', 'old');
    const newest = desktopBinary('2.1.299', 'new');
    const bins: (string | undefined)[] = [];
    const result = maybeMigrateToPlugin(
      projectRoot,
      deps({
        bundledClaude: () => findBundledClaude(home, 'darwin'),
        runClaudeInstall: (_home, _env, bin) => {
          bins.push(bin);
          return { ok: true };
        },
      }),
    );
    expect(result).toMatchObject({ state: 'installed', path: 'bundled-cli' });
    expect(bins).toEqual([newest]);
  });
  it('records skipped/no-claude-cli with user settings byte-identical when nothing is found', () => {
    const before = writeUserSettings({ model: 'x' });
    const result = maybeMigrateToPlugin(projectRoot, deps());
    expect(result).toMatchObject({ state: 'skipped', reason: 'no-claude-cli' });
    expect(readFileSync(userSettings(), 'utf8')).toBe(before);
  });
  it('records skipped/bundled-cli-failed with user settings byte-identical when the install fails', () => {
    const before = writeUserSettings({ model: 'x' });
    const result = maybeMigrateToPlugin(
      projectRoot,
      deps({
        bundledClaude: () => '/fake/claude',
        runClaudeInstall: () => ({ ok: false, reason: 'cli-install-failed:exit' }),
      }),
    );
    expect(result).toMatchObject({
      state: 'skipped',
      reason: 'bundled-cli-failed:cli-install-failed:exit',
    });
    expect(readFileSync(userSettings(), 'utf8')).toBe(before);
    const unknown = maybeMigrateToPlugin(
      projectRoot,
      deps({
        now: () => new Date('2026-10-19T12:00:00Z'),
        bundledClaude: () => '/fake/claude',
        runClaudeInstall: () => ({ ok: false }),
      }),
    );
    expect(unknown.reason).toBe('bundled-cli-failed:unknown');
  });

  it.skipIf(process.platform === 'win32')(
    'runClaudeInstallWith runs marketplace add and plugin install through the given binary',
    () => {
      const bin = desktopBinary('2.1.299', 'real');
      const calls = join(home, 'calls.txt');
      const plugins = join(home, '.claude', 'plugins');
      writeFileSync(
        bin,
        [
          '#!/bin/sh',
          `echo "$*" >> "${calls}"`,
          'if [ "$2" = "install" ]; then',
          `  mkdir -p "${plugins}"`,
          `  echo '{"paqad@eliyce":{}}' > "${join(plugins, 'installed_plugins.json')}"`,
          'fi',
          'exit 0',
          '',
        ].join('\n'),
      );
      expect(runClaudeInstallWith(home, { PATH: process.env.PATH }, bin)).toEqual({ ok: true });
      expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
        'plugin marketplace add Eliyce/paqad-ai',
        'plugin install paqad@eliyce --scope user',
      ]);
    },
  );
  it.skipIf(process.platform === 'win32')(
    'runClaudeInstallWith reports an install that exits non-zero',
    () => {
      const bin = desktopBinary('2.1.299', 'fails');
      writeFileSync(bin, '#!/bin/sh\nexit 3\n');
      expect(runClaudeInstallWith(home, { PATH: process.env.PATH }, bin)).toEqual({
        ok: false,
        reason: 'cli-install-failed:exit',
      });
    },
  );
  it('runClaudeInstallWith with no binary runs claude from PATH and reports it missing', () => {
    expect(runClaudeInstallWith(home, { PATH: '' }).reason).toMatch(
      /^cli-install-failed:(error|exit)$/,
    );
  });
});
