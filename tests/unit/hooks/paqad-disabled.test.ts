import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  anyLiveNpmHookLines,
  appendHooksLog,
  claudeDir,
  claudeSettingsPath,
  eachHookCommand,
  findProjectRootFromCwd,
  hasLiveNpmHookLines,
  hookStandsDown,
  isPluginActiveForSession,
  isSchemaVersionError,
  npmHookStepsAside,
  paqadHookScriptPath,
  parseHookPayload,
  isProjectOnboarded,
  pluginStandsDownPassive,
  pluginStandsDownUnonboarded,
  projectClaudeSettingsPaths,
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

describe('one chain per session: pluginStandsDownPassive / hookStandsDown (issue #667)', () => {
  // Every path is a temp dir: the project, the user Claude config dir (CLAUDE_CONFIG_DIR) and the
  // "installed" npm hook script. HOME/USERPROFILE are already sandboxed by tests/shared/isolate-home.ts.
  let root: string;
  let userDir: string;
  let installDir: string;
  let liveScript: string;
  const SID = 'ses-667';

  beforeEach(() => {
    root = makeRoot();
    writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
    userDir = mkdtempSync(join(tmpdir(), 'claude-config-'));
    installDir = mkdtempSync(join(tmpdir(), 'paqad-npm-install-'));
    liveScript = join(installDir, 'hooks', 'capability-gate.mjs');
    mkdirSync(join(installDir, 'hooks'), { recursive: true });
    writeFileSync(liveScript, '// hook\n');
  });
  afterEach(() => {
    for (const dir of [root, userDir, installDir]) rmSync(dir, { recursive: true, force: true });
  });

  function npmEnv(): NodeJS.ProcessEnv {
    return { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: userDir } as NodeJS.ProcessEnv;
  }
  function pluginEnv(): NodeJS.ProcessEnv {
    return { ...npmEnv(), CLAUDE_PLUGIN_ROOT: '/plugin' } as NodeJS.ProcessEnv;
  }
  function settingsBody(script: string): string {
    return JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ command: `node "${script}" pre` }] }] },
    });
  }
  function wireProject(file: 'settings.json' | 'settings.local.json', script = liveScript): void {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', file), settingsBody(script));
  }
  function claim(): void {
    writePluginActiveMarker({ session_id: SID }, npmEnv());
  }
  const payload = { session_id: SID };

  it('is false for an npm-reached hook (no CLAUDE_PLUGIN_ROOT)', () => {
    wireProject('settings.json');
    expect(pluginStandsDownPassive(payload, npmEnv())).toBe(false);
  });

  it('is false in a plugin-claimed session even when live npm hooks are wired', () => {
    wireProject('settings.json');
    claim();
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(false);
    expect(hookStandsDown(payload, pluginEnv())).toBe(false);
    expect(hookStandsDown(payload, npmEnv())).toBe(true); // the npm copy steps aside (AC-2)
  });

  it('is true for an unclaimed session when the project .claude/settings.json wires a live hook', () => {
    wireProject('settings.json');
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(true);
    expect(hookStandsDown(payload, pluginEnv())).toBe(true);
    expect(hookStandsDown(payload, npmEnv())).toBe(false); // the npm copy runs (AC-1)
  });

  it('is true when only the project settings.local.json wires a live hook', () => {
    wireProject('settings.local.json');
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(true);
  });

  it('is true when only the user settings.json wires a live hook', () => {
    writeFileSync(join(userDir, 'settings.json'), settingsBody(liveScript));
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(true);
  });

  it('is false when the wired paqad script is missing on disk, so the plugin keeps running (AC-6)', () => {
    wireProject('settings.json', join(installDir, 'hooks', 'gone.mjs'));
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(false);
    expect(hookStandsDown(payload, pluginEnv())).toBe(false);
  });

  it('is false for malformed settings JSON, so the plugin chain keeps running (AC-11)', () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{ broken');
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(false);
    expect(hookStandsDown(payload, pluginEnv())).toBe(false);
  });

  it('with no session id in an npm-wired repo, exactly one chain runs: the npm one (AC-11)', () => {
    wireProject('settings.json');
    expect(hookStandsDown(undefined, npmEnv())).toBe(false);
    expect(hookStandsDown(undefined, pluginEnv())).toBe(true);
  });

  it('in an un-onboarded repo, passive is false but hookStandsDown stays true for the plugin (AC-3)', () => {
    rmSync(join(root, '.paqad', 'framework-path.txt'));
    wireProject('settings.json');
    expect(pluginStandsDownPassive(payload, pluginEnv())).toBe(false);
    expect(hookStandsDown(payload, pluginEnv())).toBe(true);
  });

  it('the moved settings helpers keep their behaviour', () => {
    expect(claudeDir({ CLAUDE_CONFIG_DIR: userDir } as NodeJS.ProcessEnv)).toBe(userDir);
    expect(claudeDir({} as NodeJS.ProcessEnv)).toBe(join(homedir(), '.claude'));
    expect(claudeSettingsPath(npmEnv())).toBe(join(userDir, 'settings.json'));
    expect(projectClaudeSettingsPaths(root)).toEqual([
      join(root, '.claude', 'settings.json'),
      join(root, '.claude', 'settings.local.json'),
    ]);
    expect(paqadHookScriptPath(`node "${liveScript}" x`)).toBe(liveScript);
    expect(paqadHookScriptPath('echo hi')).toBeNull();
    expect(eachHookCommand(null)).toEqual([]);
    expect(
      eachHookCommand({ hooks: { Stop: 'nope', PreToolUse: [null, { hooks: [{}] }] } }),
    ).toEqual([{ event: 'PreToolUse', ei: 1, hi: 0, command: undefined }]);
    wireProject('settings.json');
    expect(hasLiveNpmHookLines(join(root, '.claude', 'settings.json'))).toBe(true);
    expect(anyLiveNpmHookLines([join(userDir, 'missing.json')])).toBe(false);
  });

  // INV-1 / AC-5: for every (claimed, npm-wired) pair exactly one chain runs. An npm hook only fires
  // when the npm chain is wired, so the npm chain runs when it is wired and does not stand down; the
  // plugin chain runs when it does not stand down.
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('claimed=%s npmWired=%s runs exactly one chain (AC-5)', (claimed, wired) => {
    if (wired) wireProject('settings.json');
    if (claimed) claim();
    const npmRuns = wired && !hookStandsDown(payload, npmEnv());
    const pluginRuns = !hookStandsDown(payload, pluginEnv());
    expect([npmRuns, pluginRuns].filter(Boolean)).toHaveLength(1);
    // When the npm chain is wired, the stand-down verdicts themselves are complementary.
    if (wired) {
      expect(hookStandsDown(payload, npmEnv())).not.toBe(hookStandsDown(payload, pluginEnv()));
    }
  });
});
