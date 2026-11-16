import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Sandbox, fakeDeps, loadLauncher, makeSandbox, payload, writeCopy } from './helpers';

const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

let sandbox: Sandbox;
let copyRoot: string;
let cli: string;

beforeEach(() => {
  sandbox = makeSandbox();
  copyRoot = join(sandbox.home, '.paqad-ai', 'team-plugin');
  cli = join(copyRoot, 'dist', 'cli', 'index.js');
  writeCopy(copyRoot);
  mkdirSync(join(copyRoot, 'dist', 'cli'), { recursive: true });
  writeFileSync(cli, '');
});
afterEach(() => sandbox.cleanup());

async function sessionStart(
  sid: string,
  env: NodeJS.ProcessEnv = {},
  script = 'agent-entry-session-start.mjs',
) {
  const launcher = await loadLauncher();
  const { deps, captured } = fakeDeps(sandbox, {
    readStdin: () => payload('SessionStart', sid),
    now: () => T0,
  });
  const code = launcher.runLauncher([script], env, deps);
  return { code, captured };
}

function writeMigration(state: string): void {
  mkdirSync(join(sandbox.home, '.paqad-ai'), { recursive: true });
  writeFileSync(
    join(sandbox.home, '.paqad-ai', 'plugin-migration.json'),
    JSON.stringify({ state, attempts: 0, version: '1' }),
  );
}

describe('AC-7: the copy route starts the plugin install in the background', () => {
  it('spawns the copy CLI plugin migrate detached, marks the session and logs one line', async () => {
    const { code, captured } = await sessionStart('s-mig');
    expect(code).toBe(0);
    expect(captured.detached).toHaveLength(1);
    const call = captured.detached[0]!;
    expect(call.command).toBe(process.execPath);
    expect(call.args).toEqual([cli, 'plugin', 'migrate', '--project-root', sandbox.project]);
    expect(call.options).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
    const mark = join(sandbox.project, '.paqad', 'session', 'plugin-migrate.d', 's-mig');
    expect(readFileSync(mark, 'utf8').trim()).toBe(new Date(T0).toISOString());
    const log = readFileSync(join(sandbox.project, '.paqad', 'logs', 'hooks.log'), 'utf8');
    expect(log).toContain('plugin install started in the background');
  });

  it('never starts it in a cloud session', async () => {
    const { captured } = await sessionStart('s-cloud', { CLAUDE_CODE_REMOTE: 'true' });
    expect(captured.detached).toEqual([]);
    expect(existsSync(join(sandbox.project, '.paqad', 'session', 'plugin-migrate.d'))).toBe(false);
  });

  it.each([
    ['CI', { CI: 'true' }],
    ['headless', { PAQAD_HEADLESS: '1' }],
    ['SDK entry point', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }],
    ['install mode settings from the environment', { PAQAD_CLAUDE_INSTALL_MODE: 'settings' }],
    ['migration turned off from the environment', { PAQAD_PLUGIN_MIGRATION: 'off' }],
  ])('AC-3: does not start it when the opt-out %s rules it out', async (_name, env) => {
    const { captured } = await sessionStart('s-optout', env as NodeJS.ProcessEnv);
    expect(captured.detached).toEqual([]);
    expect(existsSync(join(sandbox.project, '.paqad', 'session', 'plugin-migrate.d'))).toBe(false);
  });

  it.each([
    ['team yaml install mode settings', 'configs/paqad.yaml', 'claude_code:\n  install_mode: settings\n'],
    ['team yaml migration off', 'configs/paqad.yaml', 'claude_code:\n  plugin_migration: off\n'],
    ['local config install mode settings', '.config', 'claude_install_mode=settings\n'],
    ['local config migration off', '.config', 'plugin_migration=off\n'],
  ])('AC-3: does not start it when the project sets %s', async (_name, file, body) => {
    const path = join(sandbox.project, '.paqad', file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
    const { captured } = await sessionStart('s-optout-file');
    expect(captured.detached).toEqual([]);
  });

  it('AC-3: still starts it when migration is off but the install mode forces the plugin', async () => {
    const { captured } = await sessionStart('s-forced', {
      PAQAD_PLUGIN_MIGRATION: 'off',
      PAQAD_CLAUDE_INSTALL_MODE: 'plugin',
    });
    expect(captured.detached).toHaveLength(1);
  });

  it.each(['installed', 'done', 'declined', 'rolled-back'])(
    'does not start it once the migration is %s',
    async (state) => {
      writeMigration(state);
      const { captured } = await sessionStart('s-settled');
      expect(captured.detached).toEqual([]);
    },
  );

  it('retries a failed or skipped migration through the migration own schedule', async () => {
    writeMigration('failed');
    const { captured } = await sessionStart('s-failed');
    expect(captured.detached).toHaveLength(1);
  });

  it('starts it once per session, from the entry session-start script only', async () => {
    const { captured } = await sessionStart('s-other', {}, 'plugin-session-start.mjs');
    expect(captured.detached).toEqual([]);
  });

  it('does nothing when the copy has no CLI', async () => {
    rmSync(cli);
    const { captured } = await sessionStart('s-nocli');
    expect(captured.detached).toEqual([]);
  });

  it('a spawn failure logs one line and the session carries on', async () => {
    const launcher = await loadLauncher();
    const { deps } = fakeDeps(sandbox, {
      readStdin: () => payload('SessionStart', 's-fail'),
      now: () => T0,
      spawnDetached: () => {
        throw Object.assign(new Error('nope'), { code: 'EACCES' });
      },
    });
    expect(launcher.runLauncher(['agent-entry-session-start.mjs'], {}, deps)).toBe(0);
    const log = readFileSync(join(sandbox.project, '.paqad', 'logs', 'hooks.log'), 'utf8');
    expect(log).toContain('plugin install not started (EACCES)');
  });
});

describe('AC-38: with the user-scope plugin and the launcher copy both present, the hooks run once', () => {
  it('the launcher yields to the plugin that claimed the session and starts no install', async () => {
    const installPath = join(
      sandbox.home,
      '.claude',
      'plugins',
      'cache',
      'eliyce',
      'paqad',
      '9.9.9',
    );
    mkdirSync(installPath, { recursive: true });
    writeFileSync(
      join(sandbox.home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'paqad@eliyce': [{ scope: 'user', installPath }] } }),
    );
    const claims = join(sandbox.project, '.paqad', 'session', 'plugin-active.d');
    mkdirSync(claims, { recursive: true });
    writeFileSync(join(claims, 's-both'), JSON.stringify({ at: 'now', root: installPath }));
    const { code, captured } = await sessionStart('s-both');
    expect(code).toBe(0);
    expect(captured.spawns).toEqual([]);
    expect(captured.detached).toEqual([]);
  });
});
