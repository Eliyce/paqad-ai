import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendHooksLog,
  findProjectRootFromCwd,
  isPluginActiveForSession,
  isSchemaVersionError,
  npmHookStepsAside,
  parseHookPayload,
  isProjectOnboarded,
  pluginStandsDownUnonboarded,
  pluginActiveMarkerDir,
  resolveProjectRoot,
  sessionIdFrom,
  writePluginActiveMarker,
} from '../../../runtime/hooks/lib/paqad-disabled.mjs';

const SH = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.sh');
const MJS = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.mjs');

const itPosix = process.platform === 'win32' ? it.skip : it;

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-disabled-prim-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function writeConfig(root: string, body: string): void {
  writeFileSync(join(root, '.paqad', '.config'), body);
}

/** Source the shell primitive and report whether it considers paqad disabled. */
function shDisabled(root: string, extraEnv: Record<string, string> = {}): boolean {
  const out = execFileSync(
    'bash',
    ['-c', `. "${SH}"; if paqad_is_disabled; then echo disabled; else echo enabled; fi`],
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv }, encoding: 'utf8' },
  );
  return out.trim() === 'disabled';
}

/** Import the .mjs primitive in a child node and report its verdict. */
async function mjsDisabled(root: string, extraEnv: Record<string, string> = {}): Promise<boolean> {
  const script =
    `import { isPaqadDisabled } from ${JSON.stringify(pathToFileURL(MJS).href)};` +
    `process.stdout.write(String(isPaqadDisabled(${JSON.stringify(root)})));`;
  const { stdout } = await execa('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, ...extraEnv },
    reject: false,
  });
  return stdout.trim() === 'true';
}

describe('paqad-disabled primitives (.sh + .mjs agree)', () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('.mjs: default ON when no .config and no env', async () => {
    expect(await mjsDisabled(root)).toBe(false);
  });

  it('.mjs: OFF when paqad_enable=false in .config', async () => {
    writeConfig(root, 'paqad_enable=false\n');
    expect(await mjsDisabled(root)).toBe(true);
  });

  it('.mjs: does not trip on a different falsy key (enterprise=false)', async () => {
    writeConfig(root, 'enterprise=false\n');
    expect(await mjsDisabled(root)).toBe(false);
  });

  it('.mjs: env override wins over an enabled .config', async () => {
    writeConfig(root, 'paqad_enable=true\n');
    expect(await mjsDisabled(root, { PAQAD_DISABLED: '1' })).toBe(true);
  });

  itPosix('.sh: default ON when no .config and no env', () => {
    expect(shDisabled(root)).toBe(false);
  });

  itPosix('.sh: OFF when paqad_enable=false in .config', () => {
    writeConfig(root, 'paqad_enable=false\n');
    expect(shDisabled(root)).toBe(true);
  });

  itPosix('.sh: does not trip on a different falsy key (enterprise=false)', () => {
    writeConfig(root, 'enterprise=false\n');
    expect(shDisabled(root)).toBe(false);
  });

  itPosix('.sh: env override wins over an enabled .config', () => {
    writeConfig(root, 'paqad_enable=true\n');
    expect(shDisabled(root, { PAQAD_DISABLED: 'yes' })).toBe(true);
  });
});

/** Echo __paqad_resolve_project_root's result for a given cwd arg + env (issue #615, Part 1). */
function shResolveRoot(cwd: string, env: Record<string, string> = {}): string {
  return execFileSync('bash', ['-c', `. "${SH}"; __paqad_resolve_project_root "${cwd}"`], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();
}

describe('resolveProjectRoot — worktree payload cwd (issue #615, Part 1)', () => {
  let main: string;
  let worktree: string;

  beforeEach(() => {
    main = mkdtempSync(join(tmpdir(), 'paqad-main-'));
    worktree = mkdtempSync(join(tmpdir(), 'paqad-wt-'));
    mkdirSync(join(main, '.paqad'), { recursive: true });
    mkdirSync(join(worktree, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(main, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  it('walks up from payload.cwd to the worktree root, overriding CLAUDE_PROJECT_DIR', () => {
    const root = resolveProjectRoot({ CLAUDE_PROJECT_DIR: main }, { cwd: worktree });
    expect(root).toBe(worktree);
  });

  it('walks up from a subfolder of the worktree', () => {
    const sub = join(worktree, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    const root = resolveProjectRoot({ CLAUDE_PROJECT_DIR: main }, { cwd: sub });
    expect(root).toBe(worktree);
  });

  it('with no cwd, returns CLAUDE_PROJECT_DIR exactly as before', () => {
    expect(resolveProjectRoot({ CLAUDE_PROJECT_DIR: main }, undefined)).toBe(main);
    expect(resolveProjectRoot({ CLAUDE_PROJECT_DIR: main }, {})).toBe(main);
  });

  it('with a cwd that has no .paqad/ above it, falls back to CLAUDE_PROJECT_DIR', () => {
    const noPaqad = mkdtempSync(join(tmpdir(), 'paqad-none-'));
    try {
      expect(resolveProjectRoot({ CLAUDE_PROJECT_DIR: main }, { cwd: noPaqad })).toBe(main);
    } finally {
      rmSync(noPaqad, { recursive: true, force: true });
    }
  });

  it('falls back through the env chain to PAQAD_PROJECT_ROOT when no cwd and no CLAUDE_PROJECT_DIR', () => {
    expect(resolveProjectRoot({ PAQAD_PROJECT_ROOT: main }, undefined)).toBe(main);
  });

  it('findProjectRootFromCwd returns undefined when no .paqad/ exists above the start', () => {
    const noPaqad = mkdtempSync(join(tmpdir(), 'paqad-none-'));
    try {
      expect(findProjectRootFromCwd(noPaqad)).toBeUndefined();
    } finally {
      rmSync(noPaqad, { recursive: true, force: true });
    }
  });

  it('parseHookPayload tolerates empty / malformed input', () => {
    expect(parseHookPayload('')).toBeUndefined();
    expect(parseHookPayload('not json')).toBeUndefined();
    expect(parseHookPayload('42')).toBeUndefined();
    expect(parseHookPayload('{"cwd":"/x"}')).toEqual({ cwd: '/x' });
  });

  itPosix('.sh twin: __paqad_resolve_project_root walks up to the worktree root', () => {
    expect(shResolveRoot(worktree, { CLAUDE_PROJECT_DIR: main })).toBe(worktree);
  });

  itPosix('.sh twin: no cwd falls back to CLAUDE_PROJECT_DIR', () => {
    expect(shResolveRoot('', { CLAUDE_PROJECT_DIR: main })).toBe(main);
  });

  itPosix('.sh twin: a cwd with no .paqad/ above it falls back to CLAUDE_PROJECT_DIR', () => {
    const noPaqad = mkdtempSync(join(tmpdir(), 'paqad-none-'));
    try {
      expect(shResolveRoot(noPaqad, { CLAUDE_PROJECT_DIR: main })).toBe(main);
    } finally {
      rmSync(noPaqad, { recursive: true, force: true });
    }
  });
});

describe('one-copy handshake (issue #616, Part 7)', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-handshake-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('sessionIdFrom prefers the payload, then CLAUDE_SESSION_ID', () => {
    expect(sessionIdFrom({ session_id: 'abc' }, {})).toBe('abc');
    expect(sessionIdFrom(undefined, { CLAUDE_SESSION_ID: 'env-sid' })).toBe('env-sid');
    expect(sessionIdFrom(undefined, {})).toBe('');
  });

  it('writePluginActiveMarker claims a session that isPluginActiveForSession then sees', () => {
    const env = { CLAUDE_PROJECT_DIR: projectRoot };
    const payload = { session_id: 'ses-1' };
    expect(isPluginActiveForSession(payload, env)).toBe(false);
    writePluginActiveMarker(payload, env);
    expect(existsSync(join(pluginActiveMarkerDir(projectRoot), 'ses-1'))).toBe(true);
    expect(isPluginActiveForSession(payload, env)).toBe(true);
    // A different session is not claimed by this marker (per-session, INV-4).
    expect(isPluginActiveForSession({ session_id: 'ses-2' }, env)).toBe(false);
  });

  it('writePluginActiveMarker is a no-op without a session id', () => {
    writePluginActiveMarker(undefined, { CLAUDE_PROJECT_DIR: projectRoot });
    expect(existsSync(pluginActiveMarkerDir(projectRoot))).toBe(false);
  });

  it('npmHookStepsAside only when the plugin claimed the session and this is a npm hook', () => {
    const env = { CLAUDE_PROJECT_DIR: projectRoot };
    const payload = { session_id: 'ses-1' };
    expect(npmHookStepsAside(payload, env)).toBe(false); // no marker
    writePluginActiveMarker(payload, env);
    expect(npmHookStepsAside(payload, env)).toBe(true); // npm hook steps aside
    // A plugin-reached hook (CLAUDE_PLUGIN_ROOT set) never steps aside here.
    expect(npmHookStepsAside(payload, { ...env, CLAUDE_PLUGIN_ROOT: '/plugin' })).toBe(false);
  });
});

describe('future-schema handling (issue #616, Part 9)', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-schemaerr-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('isSchemaVersionError matches by code or name', () => {
    expect(isSchemaVersionError({ code: 'SCHEMA_VERSION_INCOMPATIBLE' })).toBe(true);
    expect(isSchemaVersionError({ name: 'SchemaVersionError' })).toBe(true);
    expect(isSchemaVersionError(new Error('nope'))).toBe(false);
    expect(isSchemaVersionError(null)).toBe(false);
  });

  it('appendHooksLog writes one timestamped line to .paqad/logs/hooks.log', () => {
    appendHooksLog(projectRoot, 'first line');
    appendHooksLog(projectRoot, 'second line');
    const log = readFileSync(join(projectRoot, '.paqad', 'logs', 'hooks.log'), 'utf8');
    expect(log).toContain('first line');
    expect(log).toContain('second line');
    expect(log.trim().split('\n')).toHaveLength(2);
  });
});

describe('isProjectOnboarded / pluginStandsDownUnonboarded (issue #636 bug 1)', () => {
  it('isProjectOnboarded is true only when .paqad/framework-path.txt exists', () => {
    const root = makeRoot();
    expect(isProjectOnboarded(root)).toBe(false);
    writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
    expect(isProjectOnboarded(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('pluginStandsDownUnonboarded is false for an npm-reached hook (no CLAUDE_PLUGIN_ROOT)', () => {
    const root = makeRoot();
    // No onboarding pointer, but also not a plugin hook -> never stand down (npm wires only onboarded).
    expect(
      pluginStandsDownUnonboarded(undefined, { CLAUDE_PROJECT_DIR: root } as NodeJS.ProcessEnv),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('pluginStandsDownUnonboarded is true for a plugin hook in an un-onboarded project', () => {
    const root = makeRoot();
    const env = { CLAUDE_PLUGIN_ROOT: '/plugin', CLAUDE_PROJECT_DIR: root } as NodeJS.ProcessEnv;
    expect(pluginStandsDownUnonboarded(undefined, env)).toBe(true);
    writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
    expect(pluginStandsDownUnonboarded(undefined, env)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
