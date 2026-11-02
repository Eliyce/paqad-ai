import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { teamSetupMissing } from '@/adapters/claude/team-setup.js';
import { teamSetsInstallModeSettings } from '@/core/framework-config.js';

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-install-mode-'));
  home = mkdtempSync(join(tmpdir(), 'paqad-install-mode-home-'));
  vi.stubEnv('CLAUDE_PLUGIN_ROOT', '');
  vi.stubEnv('PAQAD_FRAMEWORK_HOME', join(home, '.paqad-ai', 'current'));
  vi.stubEnv('PAQAD_TEAM_BOOTSTRAP_ENABLED', '');
  vi.stubEnv('PAQAD_CLAUDE_INSTALL_MODE', '');
  execFileSync('git', ['init', '-q'], { cwd: root });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function sharedSettings(): Record<string, unknown> {
  const file = new ClaudeCodeAdapter()
    .hostSettingsFiles(root)
    .find((entry) => entry.path === '.claude/settings.json');
  return JSON.parse(file!.content) as Record<string, unknown>;
}

function writeConfig(relative: string, body: string): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function commitSettings(settings: Record<string, unknown>): void {
  writeConfig('.claude/settings.json', `${JSON.stringify(settings, null, 2)}\n`);
  execFileSync('git', ['add', '.claude/settings.json'], { cwd: root });
}

describe('the team opt-out from the plugin', () => {
  it('reads claude_install_mode=settings from the tracked team config only', () => {
    expect(teamSetsInstallModeSettings(root)).toBe(false);
    writeConfig('.paqad/.config', 'claude_install_mode=settings\n');
    expect(teamSetsInstallModeSettings(root)).toBe(false);
    writeConfig('.paqad/configs/.config.app', 'claude_install_mode=settings\n');
    expect(teamSetsInstallModeSettings(root)).toBe(true);
  });

  it('stops the shared settings carrying the plugin keys and keeps everything else in order', () => {
    commitSettings({ model: 'sonnet', ...sharedSettings() });
    const before = sharedSettings();
    expect(before.enabledPlugins).toEqual({ 'paqad@eliyce': true });
    writeConfig('.paqad/configs/.config.app', 'claude_install_mode=settings\n');
    const after = sharedSettings();
    const rest = Object.fromEntries(
      Object.entries(before).filter(
        ([key]) => key !== 'extraKnownMarketplaces' && key !== 'enabledPlugins',
      ),
    );
    expect(after).toEqual(rest);
    expect(Object.keys(after)).toEqual(Object.keys(rest));
  });

  it('keeps other plugins and marketplaces the team committed', () => {
    commitSettings({
      ...sharedSettings(),
      enabledPlugins: { 'paqad@eliyce': true, 'other@team': true },
    });
    writeConfig('.paqad/configs/.config.app', 'claude_install_mode=settings\n');
    expect(sharedSettings().enabledPlugins).toEqual({ 'other@team': true });
  });

  it('leaves the team file alone when only a personal rollback set the mode', () => {
    commitSettings(sharedSettings());
    writeConfig('.paqad/.config', 'claude_install_mode=settings\n');
    expect(sharedSettings().enabledPlugins).toEqual({ 'paqad@eliyce': true });
  });

  it('does not report the team setup missing once the team opted out', () => {
    writeConfig('.paqad/configs/.config.app', 'claude_install_mode=settings\n');
    const settings = sharedSettings();
    writeConfig('.claude/settings.json', `${JSON.stringify(settings, null, 2)}\n`);
    writeConfig('.paqad/hook.mjs', 'x');
    expect(teamSetupMissing(root)).toBe(false);
  });
});
