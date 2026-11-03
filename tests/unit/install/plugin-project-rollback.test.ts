import { readFileSync, writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginLoadState } from '@/health/plugin-install.js';
import {
  readMigrationState,
  ROLLBACK_MESSAGE,
  ROLLBACK_PROJECT_MESSAGE,
  ROLLBACK_PROJECT_NOT_TURNED_OFF_MESSAGE,
  rollbackPlugin,
} from '@/install/plugin-migration.js';

import {
  installPlugin,
  projectPluginWorld,
  type ProjectPluginWorld,
  projectSettingsPath,
  readJson,
  turnPluginOn,
  writeRecord,
} from './project-plugin-fixture';

let world: ProjectPluginWorld;
let uninstalls: number;

beforeEach(() => {
  world = projectPluginWorld();
  uninstalls = 0;
  writeRecord(world, { state: 'done', path: 'settings', attempts: 1, version: '1.116.0' });
});
afterEach(() => world.cleanup());

function rollback(outcome: 'ok' | 'exit' = 'ok'): string {
  return rollbackPlugin(world.projectRoot, {
    home: world.home,
    version: '1.116.0',
    runClaudeUninstall: () => {
      uninstalls += 1;
      return outcome;
    },
    writeInstallModeSettings: () => {},
  });
}

describe('plugin rollback in a repo that commits the plugin', () => {
  it('turns the plugin off for this developer only and says so', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true, { model: 'sonnet' });
    const tracked = readFileSync(projectSettingsPath(world), 'utf8');
    expect(rollback()).toBe(ROLLBACK_PROJECT_MESSAGE);
    expect(readFileSync(projectSettingsPath(world), 'utf8')).toBe(tracked);
    expect(readJson(projectSettingsPath(world, true))).toEqual({
      enabledPlugins: { 'paqad@eliyce': false },
    });
    expect(pluginLoadState(world.projectRoot, { env: {}, home: world.home })).toBe('absent');
    expect(readMigrationState(world.home)?.state).toBe('rolled-back');
  });

  it('runs no user-scope uninstall when the plugin is only installed for the project', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    rollback('exit');
    expect(uninstalls).toBe(0);
  });

  it('keeps the other keys of an existing local settings file', () => {
    installPlugin(world, 'user');
    turnPluginOn(projectSettingsPath(world), true);
    turnPluginOn(projectSettingsPath(world, true), true, { permissions: { allow: ['Bash(ls)'] } });
    expect(rollback()).toBe(ROLLBACK_PROJECT_MESSAGE);
    expect(uninstalls).toBe(1);
    expect(readJson(projectSettingsPath(world, true))).toEqual({
      permissions: { allow: ['Bash(ls)'] },
      enabledPlugins: { 'paqad@eliyce': false },
    });
  });

  it('says how to opt out by hand when the local settings cannot be updated', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    writeFileSync(projectSettingsPath(world, true), '"text"');
    expect(rollback()).toBe(ROLLBACK_PROJECT_NOT_TURNED_OFF_MESSAGE);
    expect(readFileSync(projectSettingsPath(world, true), 'utf8')).toBe('"text"');
  });

  it('keeps the old message when the project does not commit the plugin', () => {
    installPlugin(world, 'user');
    expect(rollback()).toBe(ROLLBACK_MESSAGE);
  });
});
