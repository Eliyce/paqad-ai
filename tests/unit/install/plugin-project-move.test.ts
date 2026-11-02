import { existsSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  maybeMigrateToPlugin,
  readMigrationState,
  recordMigrationSession,
  retryAllowed,
} from '@/install/plugin-migration.js';

import {
  installPlugin,
  migrationDeps,
  projectPluginWorld,
  type ProjectPluginWorld,
  projectSettingsPath,
  turnPluginOn,
  userSettingsPath,
  writeRecord,
} from './project-plugin-fixture';

let world: ProjectPluginWorld;
let lines: string[];

beforeEach(() => {
  world = projectPluginWorld();
  lines = [];
});
afterEach(() => world.cleanup());

describe('the plugin move in a repo that commits the plugin', () => {
  it('skips the user-scope move, logs it once and leaves the user settings alone', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    let installs = 0;
    const deps = migrationDeps(world, lines, {
      runClaudeInstall: () => {
        installs += 1;
        return { ok: true };
      },
    });
    expect(maybeMigrateToPlugin(world.projectRoot, deps)).toEqual({
      state: 'skipped',
      reason: 'project-turns-plugin-on',
    });
    expect(maybeMigrateToPlugin(world.projectRoot, deps).reason).toBe('project-turns-plugin-on');
    expect(installs).toBe(0);
    expect(existsSync(userSettingsPath(world))).toBe(false);
    expect(lines).toEqual([
      'this project turns the plugin on in .claude/settings.json; user-scope move not needed',
    ]);
  });

  it('runs the move again once the project stops committing the plugin', () => {
    turnPluginOn(projectSettingsPath(world), true);
    const deps = migrationDeps(world, lines);
    maybeMigrateToPlugin(world.projectRoot, deps);
    const skipped = readMigrationState(world.home);
    expect(retryAllowed(skipped, new Date('2026-11-02T12:00:00Z'))).toBe(true);
    turnPluginOn(projectSettingsPath(world), false);
    expect(maybeMigrateToPlugin(world.projectRoot, deps).state).toBe('installed');
  });

  it('writes a log line when the plugin is already present and only the settings are written', () => {
    installPlugin(world, 'user');
    expect(maybeMigrateToPlugin(world.projectRoot, migrationDeps(world, lines))).toEqual({
      state: 'installed',
      path: 'settings',
    });
    expect(lines).toEqual(['plugin already present; turned it on in the user settings']);
  });

  it('writes a log line when the user turned the plugin off before the move', () => {
    installPlugin(world, 'user');
    turnPluginOn(userSettingsPath(world), false);
    expect(maybeMigrateToPlugin(world.projectRoot, migrationDeps(world, lines)).state).toBe(
      'declined',
    );
    expect(lines).toEqual(['plugin already present; not turned on (declined: user-opted-out)']);
  });
});

describe('the automatic rollback counts sessions whatever the install scope', () => {
  it('counts an npm session when the plugin is installed at project scope but never ran', async () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    writeRecord(world, {
      state: 'installed',
      path: 'settings',
      attempts: 1,
      version: '1.116.0',
      npm_sessions_since_install: 0,
      installed_at: '2026-11-01T00:00:00.000Z',
      counted_sessions: [],
    });
    const deps = { ...migrationDeps(world, lines), settleMs: 0, sleep: async () => {} };
    await recordMigrationSession({ source: 'npm', sessionId: 's1' }, deps);
    expect(readMigrationState(world.home)?.npm_sessions_since_install).toBe(1);
  });
});
