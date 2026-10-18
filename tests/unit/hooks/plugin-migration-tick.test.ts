import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  frameworkPackageRoot,
  maybeSpawnMigrationTick,
  migrationTickDue,
} from '../../../runtime/hooks/lib/plugin-migration-tick.mjs';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'paqad-tick-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function writeState(state: string): void {
  mkdirSync(join(home, '.paqad-ai'), { recursive: true });
  writeFileSync(
    join(home, '.paqad-ai', 'plugin-migration.json'),
    JSON.stringify({ state, attempts: 1, version: '1' }),
  );
}

/** A fake spawn that records its call and returns a child with on/unref. */
function fakeSpawn() {
  const child = { on: vi.fn(), unref: vi.fn() };
  const spawn = vi.fn(() => child);
  return { spawn, child };
}

describe('migrationTickDue', () => {
  it('is true only for an installed machine', () => {
    expect(migrationTickDue(home)).toBe(false); // no file
    writeState('installed');
    expect(migrationTickDue(home)).toBe(true);
    for (const state of ['done', 'pending', 'failed', 'skipped', 'rolled-back', 'declined']) {
      writeState(state);
      expect(migrationTickDue(home)).toBe(false);
    }
  });
  it('is true for a done machine whose user settings turn the plugin off (B5)', () => {
    writeState('done');
    expect(migrationTickDue(home)).toBe(false); // no settings file
    mkdirSync(join(home, '.claude'), { recursive: true });
    const settings = join(home, '.claude', 'settings.json');
    writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'paqad@eliyce': true } }));
    expect(migrationTickDue(home)).toBe(false);
    writeFileSync(settings, JSON.stringify({ theme: 'dark' }));
    expect(migrationTickDue(home)).toBe(false);
    writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }));
    expect(migrationTickDue(home)).toBe(true);
    const { spawn } = fakeSpawn();
    expect(maybeSpawnMigrationTick({ source: 'npm', cliPath: '/x', home, spawn })).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
  });
  it('is false for a corrupt file or a JSON scalar', () => {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(join(home, '.paqad-ai', 'plugin-migration.json'), '{ nope');
    expect(migrationTickDue(home)).toBe(false);
    writeFileSync(join(home, '.paqad-ai', 'plugin-migration.json'), '42');
    expect(migrationTickDue(home)).toBe(false);
  });
});

describe('maybeSpawnMigrationTick (AC-12)', () => {
  it('spawns plugin tick once, detached and silent, with the source and session', () => {
    writeState('installed');
    const { spawn, child } = fakeSpawn();
    const env = { HOME: home };
    expect(
      maybeSpawnMigrationTick({
        source: 'npm',
        sessionId: 's1',
        cliPath: '/pkg/cli.js',
        home,
        env,
        spawn,
      }),
    ).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/pkg/cli.js', 'plugin', 'tick', '--source', 'npm', '--session', 's1'],
      { detached: true, stdio: 'ignore', windowsHide: true, env },
    );
    expect(child.unref).toHaveBeenCalledOnce();
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
  it('omits --session when there is no session id', () => {
    writeState('installed');
    const { spawn } = fakeSpawn();
    maybeSpawnMigrationTick({ source: 'plugin', cliPath: '/pkg/cli.js', home, spawn });
    expect((spawn.mock.calls[0] as unknown[])[1]).toEqual([
      '/pkg/cli.js',
      'plugin',
      'tick',
      '--source',
      'plugin',
    ]);
  });
  it('spawns nothing when there is no work or no file', () => {
    const { spawn } = fakeSpawn();
    expect(maybeSpawnMigrationTick({ source: 'npm', cliPath: '/x', home, spawn })).toBe(false);
    writeState('done');
    expect(maybeSpawnMigrationTick({ source: 'npm', cliPath: '/x', home, spawn })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('swallows a throwing spawn and prints nothing', () => {
    writeState('installed');
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const spawn = vi.fn(() => {
      throw new Error('spawn failed');
    });
    expect(maybeSpawnMigrationTick({ source: 'npm', cliPath: '/x', home, spawn })).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it('resolves the CLI from the framework package when no cliPath is given', () => {
    writeState('installed');
    const pkg = join(home, 'pkg');
    mkdirSync(join(pkg, 'runtime'), { recursive: true });
    const link = join(home, 'current');
    symlinkSync(join(pkg, 'runtime'), link, process.platform === 'win32' ? 'junction' : undefined);
    const { spawn } = fakeSpawn();
    const env = { PAQAD_FRAMEWORK_HOME: link };
    expect(maybeSpawnMigrationTick({ source: 'npm', home, env, spawn })).toBe(true);
    const args = (spawn.mock.calls[0] as unknown[])[1] as string[];
    expect(args[0]!.replaceAll('\\', '/')).toMatch(/\/pkg\/dist\/cli\/index\.js$/);
  });
  it('spawns nothing when the framework link cannot be resolved', () => {
    writeState('installed');
    const { spawn } = fakeSpawn();
    const env = { PAQAD_FRAMEWORK_HOME: join(home, 'missing') };
    expect(maybeSpawnMigrationTick({ source: 'npm', home, env, spawn })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('frameworkPackageRoot', () => {
  it('returns the parent of the resolved framework link, or null', () => {
    const pkg = join(home, 'pkg');
    mkdirSync(join(pkg, 'runtime'), { recursive: true });
    expect(frameworkPackageRoot({ PAQAD_FRAMEWORK_HOME: join(pkg, 'runtime') })).toContain('pkg');
    expect(frameworkPackageRoot({ PAQAD_FRAMEWORK_HOME: join(home, 'nope') })).toBeNull();
  });
  it('defaults to ~/.paqad-ai/current under the sandboxed home', () => {
    // HOME is sandboxed by tests/shared/isolate-home.ts; with no link there it resolves to null.
    expect(frameworkPackageRoot({})).toBeNull();
  });
});
