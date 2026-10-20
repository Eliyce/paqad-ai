import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The hook keeps its logic in `__test` so each branch is exercised without touching the real home.
import { __test, runPluginSessionStart } from '../../../runtime/hooks/plugin-session-start.mjs';

const { compareVersions, readPackageVersion, repointFrameworkLink, ensureBinOnPath } = __test;
const { ensureStablePluginRuntime, stableRuntimeHome, isNpmRuntime, isPluginCacheRuntime } = __test;

let root: string;

function makeRuntime(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }), 'utf8');
  const runtime = join(dir, 'runtime');
  mkdirSync(runtime, { recursive: true });
  return runtime;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-plugin-session-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('compareVersions', () => {
  it('orders semantic versions and treats unparseable parts as 0', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.95.1', '1.95')).toBe(1);
  });
});

describe('readPackageVersion', () => {
  it('reads the version or returns null when absent/malformed', () => {
    const dir = join(root, 'pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '3.1.4' }), 'utf8');
    expect(readPackageVersion(dir)).toBe('3.1.4');
    expect(readPackageVersion(join(root, 'nope'))).toBeNull();
  });
});

describe('repointFrameworkLink (issue #616, Part 4)', () => {
  function env(home: string): NodeJS.ProcessEnv {
    return { PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv;
  }

  it('creates the link when it is missing', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('re-points a dangling link', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    symlinkSync(join(root, 'gone', 'runtime'), home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('leaves an OLDER npm copy in place — never takes over a working npm install (issue #636 bug 3)', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const npmRuntime = makeRuntime(join(root, 'npm', 'node_modules', 'paqad-ai'), '1.0.0');
    const home = join(root, 'current');
    symlinkSync(npmRuntime, home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(npmRuntime);
  });

  it('leaves a NEWER npm copy in place', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const npmRuntime = makeRuntime(join(root, 'npm', 'node_modules', 'paqad-ai'), '3.0.0');
    const home = join(root, 'current');
    symlinkSync(npmRuntime, home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(npmRuntime);
  });

  it('leaves a link already pointing at the plugin runtime', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    symlinkSync(pluginRuntime, home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('never replaces a real directory', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'keep.txt'), 'mine', 'utf8');
    repointFrameworkLink(pluginRuntime, env(home));
    expect(lstatSync(home).isDirectory()).toBe(true);
    expect(lstatSync(home).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, 'keep.txt'), 'utf8')).toBe('mine');
  });
});

describe('ensureBinOnPath (issue #616, Part 5)', () => {
  it('chmods the launcher and prepends its dir to CLAUDE_ENV_FILE PATH', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const binDir = join(pluginRuntime, 'claude-plugin', 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcher = join(binDir, 'paqad-ai');
    writeFileSync(launcher, '#!/bin/sh\n', { mode: 0o644 });
    const envFile = join(root, 'env');
    writeFileSync(envFile, '', 'utf8');

    ensureBinOnPath(pluginRuntime, {
      CLAUDE_ENV_FILE: envFile,
      PATH: '/usr/bin',
    } as NodeJS.ProcessEnv);

    const line = readFileSync(envFile, 'utf8');
    expect(line).toContain(`PATH=${binDir}`);
    expect(line).toContain('/usr/bin');
    expect(line.startsWith('export ')).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(launcher).mode & 0o777).toBe(0o755);
    }
  });

  it('does nothing harmful when CLAUDE_ENV_FILE is unset', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const binDir = join(pluginRuntime, 'claude-plugin', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'paqad-ai'), '#!/bin/sh\n', { mode: 0o644 });
    expect(() =>
      ensureBinOnPath(pluginRuntime, { PATH: '/usr/bin' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

describe('one-copy handshake (issue #616, Part 7)', () => {
  const {
    paqadHookScriptPath,
    hasLiveNpmHookLines,
    projectClaudeSettingsPaths,
    anyLiveNpmHookLines,
    removeDeadNpmHookLines,
    removeHomeStageAgents,
  } = __test;

  function settings(dir: string, commands: string[]): string {
    const path = join(dir, 'settings.json');
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: commands.map((command) => ({ command })) }],
        },
      }),
    );
    return path;
  }

  it('paqadHookScriptPath extracts a paqad .mjs path and ignores non-paqad commands', () => {
    expect(paqadHookScriptPath('node "/x/hooks/paqad/agent-entry-gate.mjs"')).toBe(
      '/x/hooks/paqad/agent-entry-gate.mjs',
    );
    expect(paqadHookScriptPath('node "/x/other.mjs"')).toBeNull();
    expect(paqadHookScriptPath('echo hi')).toBeNull();
  });

  it('hasLiveNpmHookLines is true only when a paqad hook script still exists', () => {
    const live = join(root, 'live.paqad.mjs');
    writeFileSync(live, '');
    expect(hasLiveNpmHookLines(settings(root, [`node "${live}"`]))).toBe(true);
    expect(hasLiveNpmHookLines(settings(root, [`node "${join(root, 'gone.paqad.mjs')}"`]))).toBe(
      false,
    );
    expect(hasLiveNpmHookLines(join(root, 'missing.json'))).toBe(false);
  });

  it('removeDeadNpmHookLines prunes dangling paqad hooks but keeps live + non-paqad ones', () => {
    const live = join(root, 'keep.paqad.mjs');
    writeFileSync(live, '');
    const path = settings(root, [
      `node "${live}"`,
      `node "${join(root, 'dead.paqad.mjs')}"`,
      'echo not-paqad',
    ]);
    removeDeadNpmHookLines(path);
    const after = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    const commands = after.hooks.PreToolUse[0].hooks.map((h) => h.command);
    expect(commands).toContain(`node "${live}"`);
    expect(commands).toContain('echo not-paqad');
    expect(commands.some((c) => c.includes('dead.paqad.mjs'))).toBe(false);
  });

  it('removeHomeStageAgents deletes the six paqad agent files', () => {
    const agentsDir = join(root, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    for (const name of ['paqad-planning.md', 'paqad-review.md', 'keep-me.md']) {
      writeFileSync(join(agentsDir, name), '');
    }
    removeHomeStageAgents(agentsDir);
    expect(existsSync(join(agentsDir, 'paqad-planning.md'))).toBe(false);
    expect(existsSync(join(agentsDir, 'paqad-review.md'))).toBe(false);
    expect(existsSync(join(agentsDir, 'keep-me.md'))).toBe(true);
  });

  function pluginEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    const pluginRoot = join(root, 'plugin');
    mkdirSync(join(pluginRoot, 'runtime', 'claude-plugin', 'bin'), { recursive: true });
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    writeFileSync(join(pluginRoot, 'runtime', 'claude-plugin', 'bin', 'paqad-ai'), '#!/bin/sh\n');
    const projectRoot = join(root, 'project');
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    // Issue #636 (bug 1) — the one-copy handshake and version refresh only run in an onboarded project.
    writeFileSync(join(projectRoot, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
    const configDir = join(root, 'claude-config');
    mkdirSync(configDir, { recursive: true });
    return {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      PAQAD_FRAMEWORK_HOME: join(root, 'current'),
      CLAUDE_PROJECT_DIR: projectRoot,
      CLAUDE_CONFIG_DIR: configDir,
      ...overrides,
    } as NodeJS.ProcessEnv;
  }

  it('reports a plugin-source migration tick with the plugin CLI (issue #648, B4)', () => {
    const env = pluginEnv();
    const calls: unknown[] = [];
    runPluginSessionStart(
      env,
      { session_id: 's-tick', cwd: env.CLAUDE_PROJECT_DIR },
      { tick: (args: unknown) => calls.push(args) },
    );
    expect(calls).toEqual([
      {
        source: 'plugin',
        sessionId: 's-tick',
        cliPath: join(env.CLAUDE_PLUGIN_ROOT as string, 'dist', 'cli', 'index.js'),
        env,
      },
    ]);
  });

  it('ticks even in a project that was never onboarded (a plugin-only machine still confirms)', () => {
    const env = pluginEnv({ CLAUDE_PROJECT_DIR: join(root, 'not-onboarded') });
    mkdirSync(env.CLAUDE_PROJECT_DIR as string, { recursive: true });
    const calls: unknown[] = [];
    runPluginSessionStart(env, undefined, { tick: (args: unknown) => calls.push(args) });
    expect(calls).toHaveLength(1);
  });

  it('claims the session (writes the marker) when no live npm hook lines exist', () => {
    const env = pluginEnv();
    runPluginSessionStart(env, { session_id: 's1', cwd: env.CLAUDE_PROJECT_DIR });
    const marker = join(
      env.CLAUDE_PROJECT_DIR as string,
      '.paqad',
      'session',
      'plugin-active.d',
      's1',
    );
    expect(existsSync(marker)).toBe(true);
  });

  it('claims the session in a plugin-only project whose settings carry no paqad hook', () => {
    const env = pluginEnv({ CLAUDE_PLUGIN_DATA: join(root, 'plugin-data') });
    const projectSettings = join(env.CLAUDE_PROJECT_DIR as string, '.claude', 'settings.json');
    mkdirSync(join(env.CLAUDE_PROJECT_DIR as string, '.claude'), { recursive: true });
    writeFileSync(projectSettings, JSON.stringify({ attribution: { commit: '', pr: '' } }));
    runPluginSessionStart(env, { session_id: 'sOnly', cwd: env.CLAUDE_PROJECT_DIR });
    const marker = join(
      env.CLAUDE_PROJECT_DIR as string,
      '.paqad',
      'session',
      'plugin-active.d',
      'sOnly',
    );
    expect(existsSync(marker)).toBe(true);
    expect(readlinkSync(env.PAQAD_FRAMEWORK_HOME as string)).toBe(
      join(root, 'plugin-data', 'runtime', 'runtime'),
    );
  });

  it('stays passive (no marker) when a live npm hook is still wired', () => {
    const env = pluginEnv();
    const live = join(root, 'live2.paqad.mjs');
    writeFileSync(live, '');
    settings(env.CLAUDE_CONFIG_DIR as string, [`node "${live}"`]);
    runPluginSessionStart(env, { session_id: 's2', cwd: env.CLAUDE_PROJECT_DIR });
    const marker = join(
      env.CLAUDE_PROJECT_DIR as string,
      '.paqad',
      'session',
      'plugin-active.d',
      's2',
    );
    expect(existsSync(marker)).toBe(false);
  });

  // ── Gap 2 (issue #641): the npm onboard wires the PROJECT's .claude/settings.json ──────────
  function projectClaudeSettings(projectRoot: string, file: string, commands: string[]): string {
    const dir = join(projectRoot, '.claude');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, file);
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: commands.map((command) => ({ command })) }],
        },
      }),
    );
    return path;
  }

  it('projectClaudeSettingsPaths returns the project settings.json and settings.local.json', () => {
    const projectRoot = join(root, 'p');
    expect(projectClaudeSettingsPaths(projectRoot)).toEqual([
      join(projectRoot, '.claude', 'settings.json'),
      join(projectRoot, '.claude', 'settings.local.json'),
    ]);
  });

  it('anyLiveNpmHookLines is true when ANY listed settings file wires a live paqad hook', () => {
    const live = join(root, 'any-live.paqad.mjs');
    writeFileSync(live, '');
    mkdirSync(join(root, 'user'), { recursive: true });
    const userSettings = settings(join(root, 'user'), []);
    mkdirSync(join(root, 'proj'), { recursive: true });
    const projSettings = projectClaudeSettings(join(root, 'proj'), 'settings.json', [
      `node "${live}"`,
    ]);
    expect(anyLiveNpmHookLines([userSettings, projSettings])).toBe(true);
    expect(anyLiveNpmHookLines([userSettings])).toBe(false);
    expect(anyLiveNpmHookLines([join(root, 'none.json')])).toBe(false);
  });

  it('stays passive when the live npm hook is wired in the PROJECT settings only (Gap 2)', () => {
    const env = pluginEnv();
    const live = join(root, 'proj-live.paqad.mjs');
    writeFileSync(live, '');
    // User config has NO paqad hooks; the npm chain lives in the project's .claude/settings.json.
    projectClaudeSettings(env.CLAUDE_PROJECT_DIR as string, 'settings.json', [`node "${live}"`]);
    runPluginSessionStart(env, { session_id: 's3', cwd: env.CLAUDE_PROJECT_DIR });
    const marker = join(
      env.CLAUDE_PROJECT_DIR as string,
      '.paqad',
      'session',
      'plugin-active.d',
      's3',
    );
    expect(existsSync(marker)).toBe(false);
  });

  it('stays passive when the live npm hook is wired in project settings.local.json (Gap 2)', () => {
    const env = pluginEnv();
    const live = join(root, 'proj-local-live.paqad.mjs');
    writeFileSync(live, '');
    projectClaudeSettings(env.CLAUDE_PROJECT_DIR as string, 'settings.local.json', [
      `node "${live}"`,
    ]);
    runPluginSessionStart(env, { session_id: 's4', cwd: env.CLAUDE_PROJECT_DIR });
    const marker = join(
      env.CLAUDE_PROJECT_DIR as string,
      '.paqad',
      'session',
      'plugin-active.d',
      's4',
    );
    expect(existsSync(marker)).toBe(false);
  });

  it('claims the session when NO live npm hook is wired in user OR project settings', () => {
    const env = pluginEnv();
    // Project .claude/settings.json exists but wires a non-paqad hook only → not a live npm copy.
    projectClaudeSettings(env.CLAUDE_PROJECT_DIR as string, 'settings.json', ['echo hi']);
    runPluginSessionStart(env, { session_id: 's5', cwd: env.CLAUDE_PROJECT_DIR });
    const marker = join(
      env.CLAUDE_PROJECT_DIR as string,
      '.paqad',
      'session',
      'plugin-active.d',
      's5',
    );
    expect(existsSync(marker)).toBe(true);
  });
});

describe('version refresh (issue #616, Part 9)', () => {
  const { shouldRefreshVersion, frameworkVersionTxtVersion, maybeRefreshVersion } = __test;

  function pluginRoot(version: string): string {
    const dir = join(root, 'plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
    return dir;
  }

  function projectWithVersion(version: string | null): string {
    const proj = join(root, 'project');
    mkdirSync(join(proj, '.paqad'), { recursive: true });
    if (version !== null) {
      writeFileSync(
        join(proj, '.paqad', 'framework-version.txt'),
        `version=${version}\nupdated_at=1970-01-01T00:00:00Z\n`,
      );
    }
    return proj;
  }

  it('shouldRefreshVersion only upgrades, never downgrades', () => {
    expect(shouldRefreshVersion('2.0.0', '1.0.0')).toBe(true);
    expect(shouldRefreshVersion('2.0.0', '2.0.0')).toBe(false);
    expect(shouldRefreshVersion('2.0.0', '3.0.0')).toBe(false);
    expect(shouldRefreshVersion('2.0.0', null)).toBe(true);
    expect(shouldRefreshVersion(null, '1.0.0')).toBe(false);
  });

  it('frameworkVersionTxtVersion reads the recorded version, or null when absent', () => {
    expect(frameworkVersionTxtVersion(projectWithVersion('1.2.3'))).toBe('1.2.3');
    expect(frameworkVersionTxtVersion(join(root, 'nope'))).toBeNull();
  });

  it('starts a background update when the plugin is newer, writing the lock', () => {
    const run = vi.fn();
    const proj = projectWithVersion('1.0.0');
    expect(maybeRefreshVersion(pluginRoot('2.0.0'), proj, { runUpdate: run, now: () => 0 })).toBe(
      'started',
    );
    expect(run).toHaveBeenCalledOnce();
    expect(existsSync(join(proj, '.paqad', 'locks', 'update.lock'))).toBe(true);
  });

  it('does nothing when the recorded version is current or newer', () => {
    const run = vi.fn();
    expect(
      maybeRefreshVersion(pluginRoot('2.0.0'), projectWithVersion('2.0.0'), { runUpdate: run }),
    ).toBe('current');
    expect(
      maybeRefreshVersion(pluginRoot('2.0.0'), projectWithVersion('3.0.0'), { runUpdate: run }),
    ).toBe('current');
    expect(run).not.toHaveBeenCalled();
  });

  it('throttles a second refresh while the lock is fresh', () => {
    const run = vi.fn();
    const proj = projectWithVersion('1.0.0');
    const pr = pluginRoot('2.0.0');
    maybeRefreshVersion(pr, proj, { runUpdate: run, now: () => 1000 });
    expect(maybeRefreshVersion(pr, proj, { runUpdate: run, now: () => 2000 })).toBe('throttled');
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('stable link location + self-heal (issue #636 bug 3)', () => {
  function env(home, data) {
    return { PAQAD_FRAMEWORK_HOME: home, CLAUDE_PLUGIN_DATA: data } as NodeJS.ProcessEnv;
  }

  it('classifies npm vs plugin-cache runtimes', () => {
    expect(isNpmRuntime('/x/node_modules/paqad-ai/runtime')).toBe(true);
    expect(isNpmRuntime('/x/plugins/cache/eliyce/paqad/1.0.0/runtime')).toBe(false);
    expect(isPluginCacheRuntime('/x/plugins/cache/eliyce/paqad/1.0.0/runtime')).toBe(true);
    expect(isPluginCacheRuntime('/x/node_modules/paqad-ai/runtime')).toBe(false);
  });

  it('stableRuntimeHome is CLAUDE_PLUGIN_DATA/runtime, or null when unset', () => {
    expect(stableRuntimeHome({ CLAUDE_PLUGIN_DATA: '/d' } as NodeJS.ProcessEnv)).toBe(
      join('/d', 'runtime'),
    );
    expect(stableRuntimeHome({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('ensureStablePluginRuntime copies the plugin into CLAUDE_PLUGIN_DATA/runtime', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '1.0.0');
    const data = join(root, 'data');
    const stable = ensureStablePluginRuntime(pluginRuntime, { CLAUDE_PLUGIN_DATA: data });
    expect(stable).toBe(join(data, 'runtime', 'runtime'));
    expect(lstatSync(join(data, 'runtime')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(data, 'runtime', 'version'), 'utf8').trim()).toBe('1.0.0');
  });

  it('fills a MISSING link at the stable location (not the version-specific cache)', () => {
    const pluginRuntime = makeRuntime(
      join(root, 'plugins', 'cache', 'eliyce', 'paqad', '1.0.0'),
      '1.0.0',
    );
    const home = join(root, 'current');
    const data = join(root, 'data');
    repointFrameworkLink(pluginRuntime, env(home, data));
    expect(readlinkSync(home)).toBe(join(data, 'runtime', 'runtime'));
    expect(readlinkSync(home)).not.toContain(join('cache', 'eliyce'));
  });

  it('self-heals after the plugin cache version is removed (link does not dangle)', () => {
    const v1 = makeRuntime(join(root, 'plugins', 'cache', 'eliyce', 'paqad', '1.0.0'), '1.0.0');
    const home = join(root, 'current');
    const data = join(root, 'data');
    repointFrameworkLink(v1, env(home, data));
    expect(existsSync(home)).toBe(true);
    // The cache version goes away (uninstall / cleanup).
    rmSync(join(root, 'plugins', 'cache', 'eliyce', 'paqad', '1.0.0'), {
      recursive: true,
      force: true,
    });
    expect(existsSync(home)).toBe(true);
    const v2 = makeRuntime(join(root, 'plugins', 'cache', 'eliyce', 'paqad', '1.1.0'), '1.1.0');
    repointFrameworkLink(v2, env(home, data));
    expect(existsSync(home)).toBe(true);
    expect(readFileSync(join(data, 'runtime', 'version'), 'utf8').trim()).toBe('1.1.0');
  });
});

describe('runPluginSessionStart in a project that was never onboarded (issue #636 bug 1)', () => {
  it('writes no <project>/.paqad/ marker but still runs global PATH setup', () => {
    const pluginRoot = join(root, 'plugin');
    mkdirSync(join(pluginRoot, 'runtime', 'claude-plugin', 'bin'), { recursive: true });
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    writeFileSync(join(pluginRoot, 'runtime', 'claude-plugin', 'bin', 'paqad-ai'), '#!/bin/sh\n');
    const projectRoot = join(root, 'pristine');
    mkdirSync(projectRoot, { recursive: true }); // NO .paqad/ -> never onboarded
    const envFile = join(root, 'env-file');
    writeFileSync(envFile, '');
    runPluginSessionStart(
      {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        PAQAD_FRAMEWORK_HOME: join(root, 'current'),
        CLAUDE_PROJECT_DIR: projectRoot,
        CLAUDE_CONFIG_DIR: join(root, 'cfg'),
        CLAUDE_ENV_FILE: envFile,
      } as NodeJS.ProcessEnv,
      { session_id: 'sNo', cwd: projectRoot },
    );
    // No per-project .paqad/ created at all.
    expect(existsSync(join(projectRoot, '.paqad'))).toBe(false);
    // But the global PATH line was written so /paqad:onboard can run.
    expect(readFileSync(envFile, 'utf8')).toContain('PATH=');
  });
});

describe('plugin-session-start.mjs entry guard is realpath-safe (issue #636 bug 2)', () => {
  // The hook SCRIPT is the real repo file, reached through a symlink (and/or a path with a space) so
  // process.argv[1] differs from the resolved import.meta.url — the exact case the raw guard missed,
  // silently skipping the main block. CLAUDE_PLUGIN_ROOT points at a separate test plugin dir.
  function onboardedPluginRoot(dir) {
    const pluginRoot = join(dir, 'plugin');
    mkdirSync(join(pluginRoot, 'runtime', 'claude-plugin', 'bin'), { recursive: true });
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    const launcher = join(pluginRoot, 'runtime', 'claude-plugin', 'bin', 'paqad-ai');
    writeFileSync(launcher, '#!/bin/sh\n');
    chmodSync(launcher, 0o644); // the npm tarball may drop the exec bit
    const projectRoot = join(dir, 'project');
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
    return { pluginRoot, projectRoot, launcher };
  }

  async function runFromScriptRoot(scriptRoot, dir) {
    const { pluginRoot, projectRoot, launcher } = onboardedPluginRoot(dir);
    const envFile = join(dir, 'env-file');
    writeFileSync(envFile, '');
    const result = await execa(
      process.execPath,
      [join(scriptRoot, 'runtime', 'hooks', 'plugin-session-start.mjs')],
      {
        reject: false,
        input: JSON.stringify({
          session_id: 'sEG',
          cwd: projectRoot,
          hook_event_name: 'SessionStart',
          source: 'startup',
        }),
        env: {
          ...process.env,
          HOME: join(dir, 'home'),
          USERPROFILE: join(dir, 'home'),
          CLAUDE_PLUGIN_ROOT: pluginRoot,
          PAQAD_FRAMEWORK_HOME: join(dir, 'current'),
          CLAUDE_PROJECT_DIR: projectRoot,
          CLAUDE_CONFIG_DIR: join(dir, 'cfg'),
          CLAUDE_PLUGIN_DATA: join(dir, 'data'),
          CLAUDE_ENV_FILE: envFile,
        } as NodeJS.ProcessEnv,
      },
    );
    return { result, envFile, launcher };
  }

  it('runs its main block through a SYMLINKED script path (PATH line + executable launcher)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-eg-sym-'));
    try {
      const link = join(dir, 'repo-link');
      symlinkSync(process.cwd(), link); // run the real hook through a symlink to the repo
      const { result, envFile, launcher } = await runFromScriptRoot(link, dir);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(envFile, 'utf8')).toContain('PATH=');
      // POSIX only — ensureBinOnPath deliberately skips chmod on Windows (no exec bit there).
      if (process.platform !== 'win32') {
        expect(statSync(launcher).mode & 0o111).not.toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs its main block through a script path containing a SPACE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad eg space-'));
    try {
      const link = join(dir, 'repo link'); // both the temp dir and the link name carry a space
      symlinkSync(process.cwd(), link);
      const { result, envFile, launcher } = await runFromScriptRoot(link, dir);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(envFile, 'utf8')).toContain('PATH=');
      // POSIX only — ensureBinOnPath deliberately skips chmod on Windows (no exec bit there).
      if (process.platform !== 'win32') {
        expect(statSync(launcher).mode & 0o111).not.toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plugin-seen marker (issue #621)', () => {
  const { writePluginSeen, pluginSeenPath } = __test;

  it('records version, timestamp and root at ~/.paqad-ai/plugin-seen.json', () => {
    const pluginRoot = join(root, 'plugin');
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '1.96.1' }));
    // PAQAD_FRAMEWORK_HOME dir hosts the marker, so the test controls where it lands.
    const env = { PAQAD_FRAMEWORK_HOME: join(root, 'current') };
    writePluginSeen(pluginRoot, env);
    const seen = JSON.parse(readFileSync(pluginSeenPath(env), 'utf8'));
    expect(seen.version).toBe('1.96.1');
    expect(seen.root).toBe(pluginRoot);
    expect(typeof seen.at).toBe('string');
  });
});
