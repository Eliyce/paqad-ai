import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const RUNTIME_HOOKS = join(REPO_ROOT, 'runtime', 'hooks');
const MARKER_REL = '.paqad/locks/rule-context.marker';
const LOCK_REL = '.paqad/locks/refresh-context.lock';
const HOOKS_LOG_REL = '.paqad/logs/hooks.log';

const STUB_CLI = `
const { appendFileSync } = require('node:fs');
const mode = process.env.STUB_MODE || 'ok';
appendFileSync(
  process.env.ARGS_FILE,
  JSON.stringify({
    pid: process.pid,
    args: process.argv.slice(2).join(' '),
    held: process.env.PAQAD_REFRESH_CONTEXT_LOCK_HELD ?? null,
  }) + '\\n',
);
if (mode === 'crash') process.exit(1);
if (mode === 'kill') process.kill(process.pid, 'SIGKILL');
`;

const PRIORITY_PRELOAD = `
import os from 'node:os';
import { appendFileSync } from 'node:fs';
os.setPriority = (pid, priority) => {
  appendFileSync(process.env.PRIORITY_FILE, JSON.stringify({ pid, priority }) + '\\n');
  if (process.env.PRIORITY_THROW === '1') {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  }
};
`;

interface Harness {
  pkg: string;
  trigger: string;
  argsFile: string;
  priorityFile: string;
  preload: string;
}

interface Spawn {
  pid: number;
  args: string;
  held: string | null;
}

function buildHarness(withLockModule = true): Harness {
  const pkg = mkdtempSync(join(tmpdir(), 'paqad-trigger-pkg-'));
  const hookDir = join(pkg, 'runtime', 'hooks');
  mkdirSync(hookDir, { recursive: true });
  const trigger = join(hookDir, 'context-refresh-trigger.mjs');
  copyFileSync(join(RUNTIME_HOOKS, 'context-refresh-trigger.mjs'), trigger);
  cpSync(join(RUNTIME_HOOKS, 'lib'), join(hookDir, 'lib'), { recursive: true });
  cpSync(join(REPO_ROOT, 'runtime', 'scripts'), join(pkg, 'runtime', 'scripts'), {
    recursive: true,
  });
  writeFileSync(join(pkg, 'package.json'), '{"type":"module"}\n');
  mkdirSync(join(pkg, 'dist', 'cli'), { recursive: true });
  writeFileSync(join(pkg, 'dist', 'cli', 'stub.cjs'), STUB_CLI);
  writeFileSync(join(pkg, 'dist', 'cli', 'index.js'), `import './stub.cjs';\n`);
  if (withLockModule) {
    mkdirSync(join(pkg, 'dist', 'background'), { recursive: true });
    const real = pathToFileURL(join(REPO_ROOT, 'dist', 'background', 'refresh-context-lock.js'));
    writeFileSync(
      join(pkg, 'dist', 'background', 'refresh-context-lock.js'),
      `export * from ${JSON.stringify(real.href)};\n`,
    );
  }
  const preload = join(pkg, 'priority-preload.mjs');
  writeFileSync(preload, PRIORITY_PRELOAD);
  return {
    pkg,
    trigger,
    argsFile: join(pkg, 'spawns.jsonl'),
    priorityFile: join(pkg, 'priority.jsonl'),
    preload,
  };
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

describe('runtime/hooks/context-refresh-trigger.mjs', () => {
  let projectRoot: string;
  let harness: Harness;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-trigger-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    harness = buildHarness();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(harness.pkg, { recursive: true, force: true });
  });

  function run(
    env: NodeJS.ProcessEnv = {},
    options: { sessionId?: string; target?: Harness } = {},
  ): { status: number; stdout: string } {
    const target = options.target ?? harness;
    const argv = ['--import', pathToFileURL(target.preload).href, target.trigger];
    if (options.sessionId) argv.push(options.sessionId);
    try {
      const stdout = execFileSync('node', argv, {
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectRoot,
          ARGS_FILE: target.argsFile,
          PRIORITY_FILE: target.priorityFile,
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout: stdout.toString('utf8') };
    } catch (error) {
      return { status: (error as { status: number }).status ?? 1, stdout: '' };
    }
  }

  function spawns(target: Harness = harness): Spawn[] {
    return readJsonl<Spawn>(target.argsFile);
  }

  function hooksLogLines(): string[] {
    const path = join(projectRoot, HOOKS_LOG_REL);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(Boolean);
  }

  function ageMarker(ms: number): void {
    const then = new Date(Date.now() - ms);
    utimesSync(join(projectRoot, MARKER_REL), then, then);
  }

  function holdLock(ageMs = 0): void {
    const lock = join(projectRoot, LOCK_REL);
    mkdirSync(lock, { recursive: true });
    const then = new Date(Date.now() - ageMs);
    utimesSync(lock, then, then);
  }

  it('exits 0, stamps the debounce marker and spawns one refresh when rag is on', () => {
    expect(run({ PAQAD_RAG_ENABLED: 'true' })).toEqual({ status: 0, stdout: '' });
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
    expect(spawns()).toHaveLength(1);
  });

  it('fires by default (lean on) even when rag is off', () => {
    expect(run().status).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
    expect(spawns()).toHaveLength(1);
  });

  it('is a no-op (no marker) only when both lean_rules and rag are off', () => {
    expect(run({ PAQAD_LEAN_RULES: 'false', PAQAD_RAG_ENABLED: 'false' }).status).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
    expect(spawns()).toEqual([]);
  });

  it('is a no-op (no marker) when paqad is disabled', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    expect(run({ PAQAD_RAG_ENABLED: 'true' }).status).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'runs its own dist/cli, forwards the session id and tells the child it holds the lock',
    () => {
      run({}, { sessionId: 'ses-582' });
      const [spawn] = spawns();
      expect(spawn.args).toContain('rag refresh-context');
      expect(spawn.args).toContain('--session ses-582');
      expect(spawn.held).toBe('1');
    },
  );

  it('AC-54: a second prompt within 120 s of the last spawn does not spawn', () => {
    run();
    ageMarker(60_000);
    rmSync(join(projectRoot, LOCK_REL), { recursive: true, force: true });
    run();
    expect(spawns()).toHaveLength(1);
    ageMarker(121_000);
    run();
    expect(spawns()).toHaveLength(2);
  });

  it('AC-54: a second trigger while the refresh lock is held does not spawn', () => {
    run();
    expect(existsSync(join(projectRoot, LOCK_REL))).toBe(true);
    ageMarker(121_000);
    run();
    expect(spawns()).toHaveLength(1);
  });

  it('AC-57: a held lock means no spawn and no hooks.log line', () => {
    holdLock(60_000);
    expect(run().status).toBe(0);
    expect(spawns()).toEqual([]);
    expect(hooksLogLines()).toEqual([]);
  });

  it('AC-57: a lock older than 10 minutes is reclaimed and the refresh spawns', () => {
    holdLock(11 * 60_000);
    run({}, { sessionId: 'ses-1' });
    expect(spawns()).toHaveLength(1);
    expect(hooksLogLines()).toEqual([
      expect.stringMatching(
        / context-refresh-trigger spawn reason=stale-lock-reclaimed session=ses-1 count=1$/,
      ),
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'AC-57: a child that crashes does not keep the lock',
    () => {
      run({ STUB_MODE: 'crash' });
      expect(spawns()).toHaveLength(1);
      expect(existsSync(join(projectRoot, LOCK_REL))).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'AC-57: a child killed by a signal does not keep the lock',
    () => {
      run({ STUB_MODE: 'kill' });
      expect(spawns()).toHaveLength(1);
      expect(existsSync(join(projectRoot, LOCK_REL))).toBe(false);
    },
  );

  it('AC-57: a failed spawn releases the lock at once', () => {
    rmSync(join(harness.pkg, 'dist', 'cli'), { recursive: true, force: true });
    expect(run().status).toBe(0);
    expect(existsSync(join(projectRoot, LOCK_REL))).toBe(false);
  });

  it('AC-57: lowers the child to priority 10', () => {
    run();
    const [spawn] = spawns();
    expect(readJsonl(harness.priorityFile)).toEqual([{ pid: spawn.pid, priority: 10 }]);
  });

  it('AC-57: a setPriority EPERM is swallowed and the refresh still runs', () => {
    expect(run({ PRIORITY_THROW: '1' })).toEqual({ status: 0, stdout: '' });
    expect(readJsonl(harness.priorityFile)).toHaveLength(1);
    expect(spawns()).toHaveLength(1);
    expect(hooksLogLines()).toHaveLength(1);
  });

  it('AC-58: with the dist lock module missing it skips the spawn and exits 0', () => {
    const bare = buildHarness(false);
    try {
      expect(run({}, { target: bare }).status).toBe(0);
      expect(spawns(bare)).toEqual([]);
    } finally {
      rmSync(bare.pkg, { recursive: true, force: true });
    }
  });

  it('AC-61: each spawn writes one hooks.log line with only reason, id and count', () => {
    run({}, { sessionId: 'ses/odd id' });
    const lines = hooksLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\S+ context-refresh-trigger spawn reason=lock-free session=ses_odd_id count=1$/,
    );
  });
});
