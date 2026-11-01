import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type FakeDeps,
  type Sandbox,
  LAUNCHER,
  cloneSucceeds,
  fakeDeps,
  loadLauncher,
  makeSandbox,
  payload,
  writeCopy,
} from './helpers';

const NOTICE =
  'paqad could not be set up for this repo, so its checks and evidence are off for this session. Tell the user this once, in one sentence, then continue normally.\n';
const SETUP = '{"systemMessage": "Setting up paqad for this repo (one time)."}\n';
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

let sandbox: Sandbox;
let copyRoot: string;
let lockDir: string;

beforeEach(() => {
  sandbox = makeSandbox();
  copyRoot = join(sandbox.home, '.paqad-ai', 'team-plugin');
  lockDir = join(sandbox.home, '.paqad-ai', 'locks', 'team-plugin.lock');
});
afterEach(() => {
  sandbox.cleanup();
});

function clock(start = T0): { now: () => number; sleep: (ms: number) => void; slept: number[] } {
  let t = start;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

async function launch(
  event: string,
  script: string,
  sid: string,
  overrides: Partial<FakeDeps> = {},
  env: NodeJS.ProcessEnv = {},
) {
  const launcher = await loadLauncher();
  const { deps, captured } = fakeDeps(sandbox, {
    readStdin: () => payload(event, sid),
    now: () => T0,
    ...overrides,
  });
  const gitCalls: string[][] = [];
  if (overrides.runGit === undefined) {
    deps.runGit = (args) => {
      gitCalls.push(args);
      return { status: 128 };
    };
  }
  const code = launcher.runLauncher([script], env, deps);
  return { code, captured, gitCalls };
}

function holdLock(owner: { pid: number; started_at: number }): void {
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(owner));
}

function leftovers(): string[] {
  return readdirSync(join(sandbox.home, '.paqad-ai')).filter((n) => n.startsWith('team-plugin.'));
}

describe('AC-6: first install', () => {
  it('clones once into a temp name, renames it into place, prints the setup line, releases the lock', async () => {
    const gitArgs: string[][] = [];
    const { code, captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 's1', {
      runGit: (args, options) => {
        gitArgs.push(args);
        expect(options.timeout).toBeLessThan(590_000);
        expect(existsSync(lockDir)).toBe(true);
        expect(JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'))).toEqual({
          pid: 4242,
          started_at: T0,
        });
        return cloneSucceeds(sandbox)(args);
      },
    });
    expect(code).toBe(0);
    expect(gitArgs).toEqual([
      [
        'clone',
        '--depth',
        '1',
        '--quiet',
        'https://github.com/Eliyce/paqad-claude-plugin.git',
        join(sandbox.home, '.paqad-ai', 'team-plugin.tmp-4242'),
      ],
    ]);
    expect(captured.stdout).toEqual([SETUP]);
    expect(existsSync(join(copyRoot, 'runtime', 'hooks', 'agent-entry-gate.mjs'))).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(captured.spawns.map((c) => c.args[0]!.split(/[\\/]/).pop())).toEqual([
      'plugin-session-start.mjs',
      'agent-entry-session-start.mjs',
    ]);
  });

  it('a clone missing the gate scripts is deleted and never used', async () => {
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 's2', {
      runGit: cloneSucceeds(sandbox, ['plugin-session-start.mjs']),
    });
    expect(existsSync(copyRoot)).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(captured.stdout).toEqual([NOTICE]);
    expect(captured.spawns).toEqual([]);
  });

  it('git that cannot start takes the failed path', async () => {
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 's3', {
      runGit: () => ({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }), status: null }),
    });
    expect(captured.stdout).toEqual([NOTICE]);
    expect(readFileSync(join(sandbox.project, '.paqad/logs/hooks.log'), 'utf8')).toContain(
      'clone failed (ENOENT)',
    );
  });

  it('Node older than 22 never clones and prints the notice', async () => {
    const { captured, gitCalls } = await launch(
      'SessionStart',
      'agent-entry-session-start.mjs',
      's4',
      { nodeMajor: 20 },
    );
    expect(gitCalls).toEqual([]);
    expect(captured.stdout).toEqual([NOTICE]);
  });

  it('Node older than 22 with a copy present runs nothing and says so once', async () => {
    writeCopy(copyRoot);
    const start = await launch('SessionStart', 'agent-entry-session-start.mjs', 's4b', {
      nodeMajor: 18,
    });
    expect(start.captured.spawns).toEqual([]);
    expect(start.captured.stdout).toEqual([NOTICE]);
  });

  it('the cloud setup line is used in a cloud session', async () => {
    const { captured } = await launch(
      'SessionStart',
      'agent-entry-session-start.mjs',
      's5',
      { runGit: cloneSucceeds(sandbox) },
      { CLAUDE_CODE_REMOTE: 'true' },
    );
    expect(captured.stdout).toEqual([
      '{"systemMessage": "Setting up paqad for this cloud session."}\n',
    ]);
  });
});

describe('AC-11, AC-12: the failed-install path', () => {
  it('prints the notice exactly once per session id and never blocks an edit', async () => {
    const first = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sf');
    expect(first.captured.stdout).toEqual([NOTICE]);
    expect(first.gitCalls).toHaveLength(1);
    const peer = await launch('SessionStart', 'silent-update.mjs', 'sf');
    expect(peer.captured.stdout).toEqual([]);

    const editAfter = await launch('PreToolUse', 'agent-entry-gate.mjs', 'sf');
    expect(editAfter.code).toBe(0);
    expect(editAfter.captured.stdout).toEqual([]);
    expect(editAfter.captured.stderr).toEqual([]);
    const prompt = await launch('UserPromptSubmit', 'agent-entry-prompt-gate.mjs', 'sf');
    expect(prompt.captured.stdout).toEqual([]);
    expect(existsSync(join(sandbox.project, '.paqad/session/team-bootstrap-notice.d/sf'))).toBe(
      true,
    );

    const nextSession = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sg', {
      runGit: cloneSucceeds(sandbox),
    });
    expect(nextSession.captured.stdout).toEqual([SETUP]);
    expect(existsSync(copyRoot)).toBe(true);
  });

  it('with no copy and no SessionStart record, a prompt prints the notice once and an edit passes', async () => {
    const edit = await launch('PreToolUse', 'agent-entry-gate.mjs', 'sn');
    expect(edit.code).toBe(0);
    expect(edit.captured.stdout).toEqual([]);
    const prompt = await launch('UserPromptSubmit', 'agent-entry-prompt-gate.mjs', 'sn');
    expect(prompt.captured.stdout).toEqual([NOTICE]);
    const again = await launch('UserPromptSubmit', 'agent-entry-prompt-gate.mjs', 'sn');
    expect(again.captured.stdout).toEqual([]);
    expect(edit.gitCalls).toEqual([]);
  });
});

describe('AC-9, AC-10: the install lock', () => {
  it('an orphaned lock whose owner pid is gone is taken over at once', async () => {
    holdLock({ pid: 999_999, started_at: T0 });
    const c = clock();
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 'so', {
      ...c,
      pidAlive: () => false,
      runGit: cloneSucceeds(sandbox),
    });
    expect(c.slept).toEqual([]);
    expect(captured.stdout).toEqual([SETUP]);
    expect(existsSync(copyRoot)).toBe(true);
  });

  it('a lock older than 600 s is taken over even when its pid looks alive', async () => {
    holdLock({ pid: 1, started_at: T0 - 601_000 });
    const c = clock();
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sa', {
      ...c,
      pidAlive: () => true,
      runGit: cloneSucceeds(sandbox),
    });
    expect(c.slept).toEqual([]);
    expect(captured.stdout).toEqual([SETUP]);
  });

  it('a lock without an owner file ages by its folder time', async () => {
    mkdirSync(lockDir, { recursive: true });
    const old = new Date(T0 - 700_000);
    utimesSync(lockDir, old, old);
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sm', {
      runGit: cloneSucceeds(sandbox),
    });
    expect(captured.stdout).toEqual([SETUP]);
  });

  it('a waiter on a live lock gives up after 590 s, never clones, and prints the notice once', async () => {
    holdLock({ pid: 1, started_at: T0 });
    const c = clock();
    const gitCalls: string[][] = [];
    const runGit = (args: string[]) => {
      gitCalls.push(args);
      return { status: 0 };
    };
    const { code, captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sw', {
      ...c,
      pidAlive: () => true,
      runGit,
    });
    expect(code).toBe(0);
    expect(gitCalls).toEqual([]);
    expect(c.slept.every((ms) => ms === 500)).toBe(true);
    expect(c.now() - T0).toBeGreaterThanOrEqual(590_000);
    expect(c.now() - T0).toBeLessThan(591_000);
    expect(captured.stdout).toEqual([NOTICE]);
    const prompt = await launch('UserPromptSubmit', 'agent-entry-prompt-gate.mjs', 'sw');
    expect(prompt.captured.stdout).toEqual([]);
    expect(existsSync(lockDir)).toBe(true);
  });

  it('a waiter whose peer finishes runs enforced with no setup line of its own', async () => {
    holdLock({ pid: 1, started_at: T0 });
    let ticks = 0;
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sp', {
      pidAlive: () => true,
      sleep: () => {
        ticks += 1;
        if (ticks === 3) writeCopy(copyRoot);
      },
    });
    expect(captured.stdout).toEqual([]);
    expect(captured.spawns).toHaveLength(2);
  });

  it('a waiter stops waiting when the owner fails and releases, and never clones', async () => {
    holdLock({ pid: 1, started_at: T0 });
    const { captured, gitCalls } = await launch('SessionStart', 'silent-update.mjs', 'sr', {
      pidAlive: () => true,
      sleep: () => rmSync(lockDir, { recursive: true, force: true }),
    });
    expect(gitCalls).toEqual([]);
    expect(captured.stdout).toEqual([NOTICE]);
  });

  it('the lock is atomic: a second taker is refused while the first owner is live', async () => {
    const launcher = (await loadLauncher()) as unknown as {
      acquireLock: (home: string, deps: Partial<FakeDeps>) => boolean;
    };
    const { deps } = fakeDeps(sandbox);
    expect(launcher.acquireLock(sandbox.home, deps)).toBe(true);
    expect(
      launcher.acquireLock(sandbox.home, { ...deps, pidAlive: () => true, now: () => 1e12 }),
    ).toBe(false);
  });
});

describe('taking over a stale lock', () => {
  it('never steals a lock that a peer replaced after it was judged stale', async () => {
    const launcher = (await loadLauncher()) as unknown as {
      acquireLock: (home: string, deps: Partial<FakeDeps>) => boolean;
    };
    holdLock({ pid: 5, started_at: T0 });
    let judged = false;
    const { deps } = fakeDeps(sandbox, {
      pidAlive: (pid) => {
        if (pid === 5 && !judged) {
          judged = true;
          rmSync(lockDir, { recursive: true, force: true });
          holdLock({ pid: 6, started_at: T0 + 1 });
          return false;
        }
        return true;
      },
    });
    expect(launcher.acquireLock(sandbox.home, deps)).toBe(false);
    expect(JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'))).toEqual({
      pid: 6,
      started_at: T0 + 1,
    });
    expect(leftovers()).toEqual([]);
  });

  it('retries a Windows rename that is briefly blocked, and gives up after five tries', async () => {
    type Rename = (from: string, to: string) => void;
    const launcher = (await loadLauncher()) as unknown as {
      renameWithRetry: (
        from: string,
        to: string,
        deps: { platform: string; sleep: (ms: number) => void; rename: Rename },
      ) => void;
    };
    const busy = (code: string) => Object.assign(new Error(code), { code });
    function flaky(failures: number, code = 'EPERM'): { rename: Rename; calls: () => number } {
      let calls = 0;
      return {
        rename: () => {
          calls += 1;
          if (calls <= failures) throw busy(code);
        },
        calls: () => calls,
      };
    }
    const waits: number[] = [];
    const sleep = (ms: number) => waits.push(ms);

    const twice = flaky(2);
    launcher.renameWithRetry('a', 'b', { platform: 'win32', sleep, rename: twice.rename });
    expect(twice.calls()).toBe(3);
    expect(waits).toEqual([20, 40]);

    const always = flaky(99, 'EBUSY');
    expect(() =>
      launcher.renameWithRetry('a', 'b', { platform: 'win32', sleep, rename: always.rename }),
    ).toThrow('EBUSY');
    expect(always.calls()).toBe(5);

    const posix = flaky(1);
    expect(() =>
      launcher.renameWithRetry('a', 'b', { platform: 'linux', sleep, rename: posix.rename }),
    ).toThrow('EPERM');
    expect(posix.calls()).toBe(1);
  });
});

describe('an edit while the first install runs', () => {
  it('waits up to 5 s, well inside the 10 s gate timeout, and then blocks with one line', async () => {
    holdLock({ pid: 1, started_at: T0 });
    const c = clock();
    const { code, captured } = await launch('PreToolUse', 'agent-entry-gate.mjs', 'se', {
      ...c,
      pidAlive: () => true,
    });
    expect(code).toBe(2);
    expect(c.now() - T0).toBeGreaterThanOrEqual(5_000);
    expect(c.now() - T0).toBeLessThan(6_000);
    expect(captured.stderr).toEqual([
      'paqad is still being set up for this repo, so this edit is blocked until it is ready; try it again in a moment.\n',
    ]);
    expect(captured.spawns).toEqual([]);
  });

  it('runs the gate once the copy lands during the wait', async () => {
    holdLock({ pid: 1, started_at: T0 });
    const { code, captured } = await launch('PreToolUse', 'agent-entry-gate.mjs', 'se2', {
      pidAlive: () => true,
      sleep: () => writeCopy(copyRoot),
    });
    expect(code).toBe(0);
    expect(captured.spawns).toHaveLength(1);
  });

  it('other events pass at once while the install runs', async () => {
    holdLock({ pid: 1, started_at: T0 });
    const c = clock();
    const { code } = await launch('Stop', 'verification-completion.mjs', 'se3', {
      ...c,
      pidAlive: () => true,
    });
    expect(code).toBe(0);
    expect(c.slept).toEqual([]);
  });

  it('a stale lock during an edit is treated as no install', async () => {
    holdLock({ pid: 5, started_at: T0 });
    const { code } = await launch('PreToolUse', 'agent-entry-gate.mjs', 'se4', {
      pidAlive: () => false,
    });
    expect(code).toBe(0);
  });
});

describe('AC-15: leftovers and refresh', () => {
  it('sweeps temp folders of dead installs on the next SessionStart and keeps live ones', async () => {
    writeCopy(copyRoot);
    const base = join(sandbox.home, '.paqad-ai');
    for (const name of ['team-plugin.tmp-111', 'team-plugin.tmp-222', 'team-plugin.old-333']) {
      mkdirSync(join(base, name), { recursive: true });
    }
    await launch('SessionStart', 'agent-entry-session-start.mjs', 'sl', {
      pidAlive: (pid) => pid === 222,
    });
    expect(leftovers().sort()).toEqual(['team-plugin.tmp-222']);
  });

  it.each([
    ['FETCH_HEAD 5h59m old', 'fetch', 5 * 3600_000 + 59 * 60_000, false],
    ['FETCH_HEAD 6h01m old', 'fetch', 6 * 3600_000 + 60_000, true],
    ['folder 5h59m old with no FETCH_HEAD', 'folder', 5 * 3600_000 + 59 * 60_000, false],
    ['folder 6h01m old with no FETCH_HEAD', 'folder', 6 * 3600_000 + 60_000, true],
  ])('%s starts a refresh: %s', async (_name, kind, age, expected) => {
    writeCopy(copyRoot);
    const stamp = new Date(T0 - (age as number));
    if (kind === 'fetch') {
      mkdirSync(join(copyRoot, '.git'), { recursive: true });
      writeFileSync(join(copyRoot, '.git', 'FETCH_HEAD'), '');
      utimesSync(join(copyRoot, '.git', 'FETCH_HEAD'), stamp, stamp);
      const fresh = new Date(T0);
      utimesSync(copyRoot, fresh, fresh);
    } else {
      utimesSync(copyRoot, stamp, stamp);
    }
    const { captured } = await launch('SessionStart', 'agent-entry-session-start.mjs', 'sx');
    expect(captured.detached.length > 0).toBe(expected);
    if (expected) {
      const call = captured.detached[0]!;
      expect(call.command).toBe(process.execPath);
      expect(call.args).toEqual([LAUNCHER, '--paqad-team-refresh', sandbox.project]);
      expect(call.options).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
    }
  });

  it('a refresh swaps a fresh clone in under the lock', async () => {
    writeCopy(copyRoot);
    writeFileSync(join(copyRoot, 'old-marker'), '');
    const { code } = await launch('', '--paqad-team-refresh', '', {
      runGit: cloneSucceeds(sandbox),
    });
    expect(code).toBe(0);
    expect(existsSync(join(copyRoot, 'old-marker'))).toBe(false);
    expect(existsSync(join(copyRoot, 'runtime', 'hooks', 'agent-entry-gate.mjs'))).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('a failed refresh keeps the old copy working and logs one line', async () => {
    writeCopy(copyRoot);
    writeFileSync(join(copyRoot, 'old-marker'), '');
    await launch('', '--paqad-team-refresh', '');
    expect(existsSync(join(copyRoot, 'old-marker'))).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
    const log = readFileSync(join(sandbox.project, '.paqad/logs/hooks.log'), 'utf8');
    expect(log).toContain('refresh failed; the current copy keeps working');
  });

  it('a refresh never runs while another holder has the lock', async () => {
    writeCopy(copyRoot);
    holdLock({ pid: 1, started_at: T0 });
    const gitCalls: string[][] = [];
    await launch('', '--paqad-team-refresh', '', {
      pidAlive: () => true,
      runGit: (args) => {
        gitCalls.push(args);
        return { status: 0 };
      },
    });
    expect(gitCalls).toEqual([]);
  });

  it('a refresh whose swap fails puts the old copy back', async () => {
    const launcher = (await loadLauncher()) as unknown as {
      swapCopy: (home: string, tmp: string, deps: Partial<FakeDeps>) => void;
    };
    writeCopy(copyRoot);
    writeFileSync(join(copyRoot, 'old-marker'), '');
    expect(() =>
      launcher.swapCopy(sandbox.home, join(sandbox.home, 'missing-tmp'), { pid: 7 }),
    ).toThrow();
    expect(existsSync(join(copyRoot, 'old-marker'))).toBe(true);
  });
});

const posixIt = process.platform === 'win32' ? it.skip : it;

describe('AC-6, AC-7, AC-8: two launchers racing on a fresh machine', () => {
  posixIt.each([
    ['two SessionStart lines in one session', 'same', 'same'],
    ['two sessions opened at once', 'first', 'second'],
  ])(
    '%s: exactly one clone and one setup line',
    async (_name, sidA, sidB) => {
      const bin = join(sandbox.home, 'bin');
      mkdirSync(bin, { recursive: true });
      const gitLog = join(sandbox.home, 'git.log');
      const barrier = join(sandbox.home, 'barrier');
      writeFileSync(
        join(bin, 'git'),
        [
          '#!/bin/sh',
          'echo "$*" >> "$GIT_LOG"',
          'while [ ! -f "$GIT_BARRIER" ]; do sleep 0.05; done',
          'for a in "$@"; do target="$a"; done',
          'mkdir -p "$target/runtime/hooks"',
          'for s in plugin-session-start.mjs agent-entry-session-start.mjs agent-entry-gate.mjs decision-pause-gate.mjs capability-gate.mjs silent-update.mjs; do',
          '  echo "process.exit(0)" > "$target/runtime/hooks/$s"',
          'done',
          '',
        ].join('\n'),
      );
      chmodSync(join(bin, 'git'), 0o755);
      const launcherCopy = join(sandbox.project, '.paqad', 'hook.mjs');
      copyFileSync(LAUNCHER, launcherCopy);
      const env = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: sandbox.home,
        CLAUDE_PROJECT_DIR: sandbox.project,
        GIT_LOG: gitLog,
        GIT_BARRIER: barrier,
      };
      const start = (sid: string, script: string) =>
        new Promise<{ code: number | null; stdout: string }>((resolveRun) => {
          const child = spawn(process.execPath, [launcherCopy, script], { env });
          let stdout = '';
          child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          child.on('close', (code) => resolveRun({ code, stdout }));
          child.stdin.end(JSON.stringify({ session_id: sid, hook_event_name: 'SessionStart' }));
        });
      const a = start(sidA, 'agent-entry-session-start.mjs');
      const b = start(sidB, 'silent-update.mjs');
      const deadline = Date.now() + 10_000;
      while (!existsSync(gitLog) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => setTimeout(r, 300));
      writeFileSync(barrier, '');
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.code).toBe(0);
      expect(rb.code).toBe(0);
      expect(readFileSync(gitLog, 'utf8').trim().split('\n')).toHaveLength(1);
      expect(readFileSync(gitLog, 'utf8')).toContain('team-plugin.tmp-');
      const setupLines = `${ra.stdout}${rb.stdout}`
        .split('\n')
        .filter((l) => l.includes('Setting up'));
      expect(setupLines).toHaveLength(1);
      expect(existsSync(join(copyRoot, 'runtime', 'hooks', 'agent-entry-gate.mjs'))).toBe(true);
      expect(leftovers()).toEqual([]);
      for (const sid of new Set([sidA, sidB])) {
        const record = JSON.parse(
          readFileSync(join(sandbox.project, '.paqad/session/team-route.d', sid), 'utf8'),
        ) as { route: string };
        expect(record.route).toBe('copy');
      }
    },
    30_000,
  );
});
