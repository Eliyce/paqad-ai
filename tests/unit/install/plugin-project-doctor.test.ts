import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginOptedOutLocally, projectTurnsPluginOn } from '@/health/plugin-install.js';
import { describeClaudeInstall } from '@/install/plugin-migration.js';

import {
  installPlugin,
  projectPluginWorld,
  type ProjectPluginWorld,
  projectSettingsPath,
  turnPluginOn,
  userSettingsPath,
  writeRecord,
} from './project-plugin-fixture';

const NPM_CLI = '/usr/lib/node_modules/paqad-ai/dist/cli/index.js';

let world: ProjectPluginWorld;

beforeEach(() => {
  world = projectPluginWorld();
});
afterEach(() => world.cleanup());

function doctor(version = '1.116.0') {
  return describeClaudeInstall(
    world.home,
    world.projectRoot,
    {},
    {
      managedSettingsPaths: [],
      cliEntry: NPM_CLI,
      version,
    },
  );
}

describe('which layer turns the plugin on for a project', () => {
  it('reads the project settings and the local opt-out on their own', () => {
    expect(projectTurnsPluginOn(world.projectRoot)).toBe(false);
    expect(pluginOptedOutLocally(world.projectRoot)).toBe(false);
    turnPluginOn(projectSettingsPath(world), true);
    turnPluginOn(projectSettingsPath(world, true), false);
    expect(projectTurnsPluginOn(world.projectRoot)).toBe(true);
    expect(pluginOptedOutLocally(world.projectRoot)).toBe(true);
  });
});

describe('the doctor line in a repo that commits the plugin', () => {
  it('names the project when the user turned the plugin off but the project turns it on', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    turnPluginOn(userSettingsPath(world), false);
    writeRecord(world, { state: 'done', path: 'settings', attempts: 1, version: '1.116.0' });
    const result = doctor();
    expect(result.detail).toBe(
      'plugin (turned on by this project); plugin v1.116.0, paqad-ai v1.116.0',
    );
    expect(result.level).toBe('warning');
    expect(result.remediation).toContain('paqad-ai plugin rollback');
  });

  it('never says npm after a rollback while the project still loads the plugin', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    writeRecord(world, {
      state: 'rolled-back',
      reason: 'manual',
      attempts: 1,
      version: '1.116.0',
    });
    expect(doctor()).toEqual({
      detail: 'plugin (turned on by this project); plugin v1.116.0, paqad-ai v1.116.0',
      level: 'pass',
    });
  });

  it('keeps the version warning when the plugin and paqad-ai differ', () => {
    installPlugin(world, 'user', '1.115.0');
    turnPluginOn(projectSettingsPath(world), true);
    const result = doctor();
    expect(result.detail).toBe(
      'plugin (turned on by this project); plugin v1.115.0, paqad-ai v1.116.0',
    );
    expect(result.level).toBe('warning');
    expect(result.remediation).toContain('claude plugin update');
  });

  it('says the plugin is off for this developer when the local settings turn it off', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    turnPluginOn(projectSettingsPath(world, true), false);
    expect(doctor()).toEqual({
      detail: 'npm (plugin turned off for you in .claude/settings.local.json)',
      level: 'pass',
    });
  });

  it('says it waits for Claude Code when the project turns the plugin on but it is not installed', () => {
    turnPluginOn(projectSettingsPath(world), true);
    expect(doctor()).toEqual({
      detail: 'npm (this project turns the plugin on; waiting for Claude Code to install it)',
      level: 'pass',
    });
  });

  it('keeps the user-scope reading when the project does not commit the plugin', () => {
    installPlugin(world, 'user');
    turnPluginOn(userSettingsPath(world), false);
    writeRecord(world, { state: 'done', path: 'settings', attempts: 1, version: '1.116.0' });
    expect(doctor().detail).toBe('npm (migration declined: user-disabled)');
  });
});
