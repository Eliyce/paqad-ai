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
  it('AC-2: a project-scope install still gets the user-scope install', () => {
    installPlugin(world, 'project');
    turnPluginOn(projectSettingsPath(world), true);
    let installs = 0;
    const deps = migrationDeps(world, lines, {
      runClaudeInstall: () => {
        installs += 1;
        return { ok: true };
      },
    });
    expect(maybeMigrateToPlugin(world.projectRoot, deps)).toMatchObject({
      state: 'installed',
      path: 'cli',
    });
    expect(installs).toBe(1);
    expect(readMigrationState(world.home)?.reason).toBeUndefined();
  });

  it('AC-2: a repo that commits the plugin gets the move without waiting for a retry', () => {
    turnPluginOn(projectSettingsPath(world), true);
    writeRecord(world, {
      state: 'skipped',
      reason: 'project-turns-plugin-on',
      attempts: 0,
      version: '1.116.0',
      last_attempt_at: '2026-11-01T00:00:00.000Z',
    });
    expect(retryAllowed(readMigrationState(world.home), new Date('2026-11-01T00:01:00Z'))).toBe(
      true,
    );
    expect(maybeMigrateToPlugin(world.projectRoot, migrationDeps(world, lines)).state).toBe(
      'installed',
    );
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
    expect(lines).toEqual(['plugin turned off (user-opted-out); not installing']);
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
