import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPluginCommand } from '@/cli/commands/plugin.js';

const statePath = (): string => join(homedir(), '.paqad-ai', 'plugin-migration.json');

function writeState(record: Record<string, unknown>): void {
  mkdirSync(join(homedir(), '.paqad-ai'), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(record));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('paqad-ai plugin tick (hidden)', () => {
  it('is hidden from help', () => {
    expect(createPluginCommand().helpInformation()).not.toContain('tick');
  });

  it('records a plugin session silently (installed → done)', async () => {
    writeState({ state: 'installed', path: 'settings', attempts: 1, version: '1' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createPluginCommand().parseAsync(['node', 'plugin', 'tick', '--source', 'plugin']);
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).state).toBe('done');
    expect(log).not.toHaveBeenCalled();
  });

  it('ignores an unknown source and leaves the state alone', async () => {
    writeState({ state: 'installed', path: 'settings', attempts: 1, version: '1' });
    await createPluginCommand().parseAsync([
      'node',
      'plugin',
      'tick',
      '--source',
      'codex',
      '--session',
      's1',
    ]);
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).state).toBe('installed');
  });
});

describe('paqad-ai plugin rollback', () => {
  it('prints the manual uninstall line when no claude can be reached and the plugin is still recorded', async () => {
    const plugins = join(homedir(), '.claude', 'plugins');
    mkdirSync(plugins, { recursive: true });
    writeFileSync(join(plugins, 'installed_plugins.json'), JSON.stringify({ 'paqad@eliyce': {} }));
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rollback-'));
    const path = process.env.PATH;
    const appData = process.env.APPDATA;
    process.env.PATH = '';
    process.env.APPDATA = join(homedir(), 'AppData', 'Roaming');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await createPluginCommand().parseAsync([
        'node',
        'plugin',
        'rollback',
        '--project-root',
        projectRoot,
      ]);
      expect(log).toHaveBeenCalledWith(
        'The plugin is turned off. Run `claude plugin uninstall paqad@eliyce` to remove it.',
      );
    } finally {
      process.env.PATH = path;
      if (appData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = appData;
      rmSync(join(plugins, 'installed_plugins.json'), { force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
