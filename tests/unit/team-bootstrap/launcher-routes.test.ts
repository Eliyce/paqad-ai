import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as lib from '../../../runtime/hooks/lib/paqad-disabled.mjs';
import { type Sandbox, fakeDeps, loadLauncher, makeSandbox, payload, writeCopy } from './helpers';

let sandbox: Sandbox;
let claudeConfig: string;
let installPath: string;

beforeEach(() => {
  sandbox = makeSandbox();
  claudeConfig = join(sandbox.home, '.claude');
  installPath = join(claudeConfig, 'plugins', 'cache', 'eliyce', 'paqad', '9.9.9');
  mkdirSync(installPath, { recursive: true });
  writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
});
afterEach(() => {
  sandbox.cleanup();
});

function writeInstalled(body: unknown): void {
  writeFileSync(
    join(claudeConfig, 'plugins', 'installed_plugins.json'),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

function entry(extra: object = {}): object {
  return { version: 2, plugins: { 'paqad@eliyce': [{ scope: 'user', installPath, ...extra }] } };
}

function writeSettings(path: string, enabled: boolean): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ enabledPlugins: { 'paqad@eliyce': enabled } }));
}

async function runEvent(
  env: NodeJS.ProcessEnv,
  event = 'PreToolUse',
  script = 'agent-entry-gate.mjs',
  sessionId = 'ses-route',
) {
  const launcher = await loadLauncher();
  const { deps, captured } = fakeDeps(sandbox, { readStdin: () => payload(event, sessionId) });
  const code = launcher.runLauncher([script], env, deps);
  return { code, captured };
}

interface PluginCase {
  name: string;
  setup: () => void;
}

const FALL_THROUGH: PluginCase[] = [
  { name: 'installPath missing', setup: () => writeInstalled(entry({ installPath: undefined })) },
  {
    name: 'installPath not on disk',
    setup: () => writeInstalled(entry({ installPath: join(sandbox.home, 'gone') })),
  },
  { name: 'malformed JSON', setup: () => writeInstalled('{ nope') },
  {
    name: 'format version other than 2',
    setup: () => writeInstalled({ ...entry(), version: 3 }),
  },
  {
    name: 'project scope for another repo',
    setup: () => writeInstalled(entry({ scope: 'project', projectPath: sandbox.home })),
  },
  {
    name: 'turned off in user settings',
    setup: () => {
      writeInstalled(entry());
      writeSettings(join(claudeConfig, 'settings.json'), false);
    },
  },
  {
    name: 'turned off in project settings',
    setup: () => {
      writeInstalled(entry());
      writeSettings(join(sandbox.project, '.claude', 'settings.json'), false);
    },
  },
  {
    name: 'turned off in local settings over a project true',
    setup: () => {
      writeInstalled(entry());
      writeSettings(join(sandbox.project, '.claude', 'settings.json'), true);
      writeSettings(join(sandbox.project, '.claude', 'settings.local.json'), false);
    },
  },
  {
    name: 'CLAUDE_CONFIG_DIR points at another folder',
    setup: () => writeInstalled(entry()),
  },
];

describe('the plugin route steps aside only for a plugin that loads here', () => {
  it('a user-scope install that loads here exits 0 and starts no child', async () => {
    writeInstalled(entry());
    for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
      const { code, captured } = await runEvent({}, event);
      expect(code).toBe(0);
      expect(captured.spawns).toEqual([]);
      expect(captured.stdout).toEqual([]);
    }
  });

  it('a project-scope install for this repo and a bare entry also count', async () => {
    writeInstalled(entry({ scope: 'local', projectPath: sandbox.project }));
    expect((await runEvent({})).captured.spawns).toEqual([]);
    writeInstalled({ version: 2, plugins: { 'paqad@eliyce': { installPath } } });
    expect((await runEvent({})).captured.spawns).toEqual([]);
  });

  it('a user false is overridden by a project true', async () => {
    writeInstalled(entry());
    writeSettings(join(claudeConfig, 'settings.json'), false);
    writeSettings(join(sandbox.project, '.claude', 'settings.json'), true);
    expect((await runEvent({})).captured.spawns).toEqual([]);
  });

  it.each(FALL_THROUGH.map((c) => [c.name, c] as const))(
    '%s falls through to the copy route',
    async (_name, pluginCase) => {
      pluginCase.setup();
      const env =
        pluginCase.name === 'CLAUDE_CONFIG_DIR points at another folder'
          ? { CLAUDE_CONFIG_DIR: join(sandbox.home, 'elsewhere') }
          : {};
      const { captured } = await runEvent(env);
      expect(captured.spawns).toHaveLength(1);
      expect(captured.spawns[0]!.options.env?.CLAUDE_PLUGIN_ROOT).toBe(
        join(sandbox.home, '.paqad-ai', 'team-plugin'),
      );
    },
  );
});

describe('the launcher and the hook libs agree on the plugin', () => {
  const fixtures: Array<[string, () => void]> = [
    ['user entry', () => writeInstalled(entry())],
    ['bare map', () => writeInstalled({ 'paqad@eliyce': [{ installPath }] })],
    [
      'single object',
      () => writeInstalled({ version: 2, plugins: { 'paqad@eliyce': { installPath } } }),
    ],
    ['no entry', () => writeInstalled({ version: 2, plugins: {} })],
    ['malformed', () => writeInstalled('[')],
    ['version 1', () => writeInstalled({ ...entry(), version: 1 })],
    ['missing file', () => undefined],
    ['blank installPath', () => writeInstalled(entry({ installPath: ' ' }))],
    [
      'other project',
      () => writeInstalled(entry({ scope: 'project', projectPath: join(sandbox.home, 'x') })),
    ],
    [
      'this project',
      () => writeInstalled(entry({ scope: 'project', projectPath: sandbox.project })),
    ],
    ['project scope without a path', () => writeInstalled(entry({ scope: 'local' }))],
    [
      'turned off by user',
      () => {
        writeInstalled(entry());
        writeSettings(join(claudeConfig, 'settings.json'), false);
      },
    ],
    [
      'turned back on locally',
      () => {
        writeInstalled(entry());
        writeSettings(join(sandbox.project, '.claude', 'settings.json'), false);
        writeSettings(join(sandbox.project, '.claude', 'settings.local.json'), true);
      },
    ],
  ];

  it.each(fixtures)('%s', async (_name, setup) => {
    setup();
    const launcher = (await loadLauncher()) as unknown as {
      installedPluginRoots: (env: NodeJS.ProcessEnv, home: string) => string[] | null;
      pluginLoadState: (root: string, env: NodeJS.ProcessEnv, home: string) => string;
      pluginEnabledInSettings: (root: string, env: NodeJS.ProcessEnv, home: string) => boolean;
    };
    const env = { CLAUDE_CONFIG_DIR: claudeConfig } as NodeJS.ProcessEnv;
    expect(launcher.installedPluginRoots(env, sandbox.home)).toEqual(lib.installedPluginRoots(env));
    expect(launcher.pluginLoadState(sandbox.project, env, sandbox.home)).toBe(
      lib.pluginLoadState(sandbox.project, env),
    );
    expect(launcher.pluginEnabledInSettings(sandbox.project, env, sandbox.home)).toBe(
      lib.pluginEnabledInSettings(sandbox.project, env),
    );
  });
});

describe('the npm route forwards to the npm install', () => {
  function npmInstall(kind: 'node_modules' | 'dev'): string {
    const pkg =
      kind === 'node_modules'
        ? join(sandbox.home, 'lib', 'node_modules', 'paqad-ai')
        : join(sandbox.home, 'checkout');
    mkdirSync(join(pkg, 'runtime', 'hooks'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'paqad-ai' }));
    writeFileSync(join(pkg, 'runtime', 'hooks', 'agent-entry-gate.mjs'), '');
    mkdirSync(join(sandbox.home, '.paqad-ai'), { recursive: true });
    symlinkSync(
      join(pkg, 'runtime'),
      join(sandbox.home, '.paqad-ai', 'current'),
      process.platform === 'win32' ? 'junction' : undefined,
    );
    return join(pkg, 'runtime');
  }

  it.each(['node_modules', 'dev'] as const)(
    'a %s install runs <target>/hooks/<script> with no plugin env',
    async (kind) => {
      const target = npmInstall(kind);
      const { captured } = await runEvent({ PATH: 'x' });
      expect(captured.spawns).toHaveLength(1);
      const call = captured.spawns[0]!;
      expect(call.args[0]).toBe(join(target, 'hooks', 'agent-entry-gate.mjs'));
      expect(call.options.env).toEqual({ PATH: 'x' });
      expect(call.options.env).not.toHaveProperty('CLAUDE_PLUGIN_ROOT');
    },
  );

  it('PAQAD_FRAMEWORK_HOME names the install', async () => {
    const target = npmInstall('dev');
    const { captured } = await runEvent({ PAQAD_FRAMEWORK_HOME: target });
    expect(captured.spawns[0]!.args[0]).toBe(join(target, 'hooks', 'agent-entry-gate.mjs'));
  });

  it('a linked build that is not paqad-ai, or the launcher copy itself, is not npm', async () => {
    const other = join(sandbox.home, 'other');
    mkdirSync(join(other, 'runtime', 'hooks'), { recursive: true });
    writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'something-else' }));
    const copyRuntime = join(sandbox.home, '.paqad-ai', 'team-plugin', 'runtime');
    for (const target of [join(other, 'runtime'), copyRuntime]) {
      const { captured } = await runEvent({ PAQAD_FRAMEWORK_HOME: target });
      expect(captured.spawns[0]!.options.env?.CLAUDE_PLUGIN_ROOT).toBe(
        join(sandbox.home, '.paqad-ai', 'team-plugin'),
      );
    }
  });

  it('never runs the copy, so ~/.paqad-ai/current still points at the npm package', async () => {
    const target = npmInstall('node_modules');
    for (const [event, script] of [
      ['SessionStart', 'agent-entry-session-start.mjs'],
      ['PreToolUse', 'agent-entry-gate.mjs'],
    ]) {
      const { captured } = await runEvent({}, event, script);
      for (const call of captured.spawns) {
        expect(call.args[0]!.startsWith(target)).toBe(true);
      }
    }
    expect(readlinkSync(join(sandbox.home, '.paqad-ai', 'current'))).toBe(target);
  });

  it('a missing npm hook script blocks PreToolUse and passes other events', async () => {
    npmInstall('dev');
    const blocked = await runEvent({}, 'PreToolUse', 'decision-pause-gate.mjs');
    expect(blocked.code).toBe(2);
    expect(blocked.captured.stderr.join('')).toContain('paqad-ai update');
    const stop = await runEvent({}, 'Stop', 'stage-marker-parse.mjs');
    expect(stop.code).toBe(0);
  });
});

describe('the route is decided once per session', () => {
  it('SessionStart records the route and a later event follows it', async () => {
    const start = await runEvent({}, 'SessionStart', 'agent-entry-session-start.mjs', 'ses-a');
    expect(start.captured.spawns.map((c) => c.args[0]!.split(/[\\/]/).pop())).toEqual([
      'plugin-session-start.mjs',
      'agent-entry-session-start.mjs',
    ]);
    const record = JSON.parse(
      readFileSync(join(sandbox.project, '.paqad/session/team-route.d/ses-a'), 'utf8'),
    ) as { route: string };
    expect(record.route).toBe('copy');

    writeInstalled(entry());
    const later = await runEvent({}, 'PreToolUse', 'agent-entry-gate.mjs', 'ses-a');
    expect(later.captured.spawns).toHaveLength(1);
    const next = await runEvent({}, 'PreToolUse', 'agent-entry-gate.mjs', 'ses-b');
    expect(next.captured.spawns).toEqual([]);
  });

  it('a recorded route still honours PAQAD_DISABLED', async () => {
    await runEvent({}, 'SessionStart', 'agent-entry-session-start.mjs', 'ses-c');
    const later = await runEvent(
      { PAQAD_DISABLED: '1' },
      'PreToolUse',
      'agent-entry-gate.mjs',
      'ses-c',
    );
    expect(later.captured.spawns).toEqual([]);
  });

  it('logs one line naming the route on SessionStart and never logs stdin or env', async () => {
    await runEvent(
      { SECRET_TOKEN: 'abc123' },
      'SessionStart',
      'agent-entry-session-start.mjs',
      'ses-d',
    );
    await runEvent({}, 'SessionStart', 'silent-update.mjs', 'ses-d');
    const log = readFileSync(join(sandbox.project, '.paqad/logs/hooks.log'), 'utf8');
    const lines = log.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('route=copy');
    expect(log).not.toContain('abc123');
    expect(log).not.toContain('ses-d');
  });

  it.each([
    ['no session id', JSON.stringify({ hook_event_name: 'SessionStart' })],
    [
      'a session id with path characters',
      JSON.stringify({ session_id: '../../x', hook_event_name: 'SessionStart' }),
    ],
    [
      'a session id with a separator',
      JSON.stringify({ session_id: 'a/b', hook_event_name: 'UserPromptSubmit' }),
    ],
  ])('%s neither crashes nor writes outside .paqad/session', async (_name, body) => {
    const launcher = await loadLauncher();
    const { deps } = fakeDeps(sandbox, { readStdin: () => Buffer.from(body) });
    expect(() => launcher.runLauncher(['agent-entry-session-start.mjs'], {}, deps)).not.toThrow();
    const sessionDir = join(sandbox.project, '.paqad', 'session');
    const written = existsSync(sessionDir) ? readdirSync(sessionDir, { recursive: true }) : [];
    expect(written.filter((name) => String(name).includes('..'))).toEqual([]);
    expect(existsSync(join(sandbox.project, 'x'))).toBe(false);
    expect(existsSync(join(sandbox.project, '.paqad', 'x'))).toBe(false);
  });

  it('a script name with path characters is never run', async () => {
    const { code, captured } = await runEvent({}, 'PreToolUse', '../../evil.mjs');
    expect(code).toBe(2);
    expect(captured.spawns).toEqual([]);
  });
});

describe('the launcher stays cheap', () => {
  it('its own work before the hook starts stays under 50 ms', async () => {
    const launcher = await loadLauncher();
    await runEvent({}, 'SessionStart', 'agent-entry-session-start.mjs', 'ses-perf');
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      let startedAt = 0;
      const begin = performance.now();
      const { deps } = fakeDeps(sandbox, {
        readStdin: () => payload('PreToolUse', 'ses-perf'),
        spawnSync: () => {
          startedAt = performance.now();
          return { status: 0 };
        },
      });
      launcher.runLauncher(['capability-gate.mjs', 'pre-mutation'], {}, deps);
      samples.push(startedAt - begin);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(50);
  });
});
