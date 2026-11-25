import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfigCommand, setUpdateSetting } from '@/cli/commands/config.js';

let root: string;

const SETTINGS = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  permissions: { allow: ['Bash(ls)'] },
  extraKnownMarketplaces: {
    eliyce: { source: { source: 'github', repo: 'Eliyce/paqad-claude-plugin' }, autoUpdate: true },
    other: { source: { source: 'github', repo: 'someone/else' } },
  },
  enabledPlugins: { 'paqad@eliyce': true },
};

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function marketplace(): Record<string, unknown> {
  return (settings().extraKnownMarketplaces as Record<string, Record<string, unknown>>).eliyce!;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-config-set-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/settings.json'), `${JSON.stringify(SETTINGS, null, 2)}\n`);
  mkdirSync(join(root, '.paqad/configs'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/configs/paqad.yaml'),
    '# why we keep updates\nupdates:\n  automatic: true # on for now\nenabled: true\n',
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('paqad-ai config set (FR-32)', () => {
  it('AC-29: config set auto_update false writes autoUpdate false at once and prints the commit note', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await createConfigCommand().parseAsync(
      ['set', 'auto_update', 'false', '--project-root', root],
      { from: 'user' },
    );
    expect(marketplace().autoUpdate).toBe(false);
    const printed = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain(
      'Commit these team setup files together so teammates and cloud sessions get paqad: .paqad/configs/paqad.yaml, .claude/settings.json.',
    );
    const yaml = readFileSync(join(root, '.paqad/configs/paqad.yaml'), 'utf8');
    expect(yaml).toContain('# why we keep updates');
    expect(yaml).toContain('automatic: false');
    expect(yaml).toContain('enabled: true');
  });

  it('AC-29: every other settings key stays as it was', () => {
    setUpdateSetting(root, 'updates.automatic', 'false', {});
    const after = settings();
    expect(after.permissions).toEqual(SETTINGS.permissions);
    expect(after.enabledPlugins).toEqual(SETTINGS.enabledPlugins);
    expect((after.extraKnownMarketplaces as Record<string, unknown>).other).toEqual(
      SETTINGS.extraKnownMarketplaces.other,
    );
    expect(marketplace().source).toEqual(SETTINGS.extraKnownMarketplaces.eliyce.source);
  });

  it('AC-29: a pin set through config set stops the plugin route, and clearing it turns it back on', () => {
    expect(setUpdateSetting(root, 'minimum_version', '1.2.3', {}).error).toBeUndefined();
    expect(marketplace().autoUpdate).toBe(false);
    expect(readFileSync(join(root, '.paqad/configs/paqad.yaml'), 'utf8')).toContain(
      'minimum_version: 1.2.3',
    );
    setUpdateSetting(root, 'updates.minimum_version', 'latest', {});
    expect(marketplace().autoUpdate).toBe(true);
  });

  it('AC-29: a personal PAQAD_AUTO_UPDATE never reaches the committed settings', () => {
    const result = setUpdateSetting(root, 'auto_update', 'true', { PAQAD_AUTO_UPDATE: '0' });
    expect(result.lines).toEqual([
      'Set auto_update to true.',
      'Commit these team setup files together so teammates and cloud sessions get paqad: .paqad/configs/paqad.yaml.',
    ]);
    expect(marketplace().autoUpdate).toBe(true);
  });

  it('AC-29: refuses other keys and values that are not a switch or an exact version', () => {
    expect(setUpdateSetting(root, 'rag_top_n', '3', {}).error).toContain('config set changes only');
    expect(setUpdateSetting(root, 'auto_update', 'maybe', {}).error).toContain('true or false');
    expect(setUpdateSetting(root, 'minimum_version', '^1.2', {}).error).toContain('exact version');
    expect(marketplace().autoUpdate).toBe(true);
  });
});
