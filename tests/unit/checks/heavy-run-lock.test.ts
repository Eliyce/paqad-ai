import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireHeavyRunLock,
  describeHeavyRunHolder,
  heavyRunLockPath,
  recordHeavyRunReclaim,
  type HeavyRunHolder,
} from '@/checks/heavy-run-lock.js';
import {
  endAgentRuns,
  processGroupOf,
  processStartTime,
  readAgentRunRecords,
  writeAgentRunRecord,
} from '@/checks/running-marker.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

import { openChange } from '../traceability/change-map.fixture.js';

const runner = vi.hoisted(() => ({ windows: process.platform === 'win32' }));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const asPosix = <T>(stat: T): T => {
    if (runner.windows && process.platform !== 'win32' && stat && typeof stat === 'object') {
      const entry = stat as unknown as { mode: number };
      if (typeof entry.mode === 'number') entry.mode &= ~0o077;
    }
    return stat;
  };
  const lstatSync = ((...args: Parameters<typeof fs.lstatSync>) =>
    asPosix(fs.lstatSync(...args))) as typeof fs.lstatSync;
  const fstatSync = ((...args: Parameters<typeof fs.fstatSync>) =>
    asPosix(fs.fstatSync(...args))) as typeof fs.fstatSync;
  return { ...fs, default: { ...fs, lstatSync, fstatSync }, lstatSync, fstatSync };
});

async function asPlatform<T>(platform: NodeJS.Platform, run: () => T | Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-heavy-run-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function readdirOne(dir: string): string {
  return join(dir, readdirSync(dir)[0]!);
}

function liveProcess(pid: number): boolean {
  try {
    const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return stat.length > 0 && !stat.startsWith('Z');
  } catch {
    return false;
  }
}

describe('heavy-run lock', () => {
  it('keeps the lock under the home folder, fixed in code', () => {
    const home = join(tmpdir(), 'fake-home');
    expect(heavyRunLockPath(home)).toBe(join(home, '.paqad-ai', 'locks', 'heavy-run.json'));
  });

  it('AC-12 a second checks run waits in line and prints which run holds the lock', async () => {
    const root = tempRoot();
    const lockPath = join(root, 'locks', 'heavy-run.json');
    const alive = { startTimeOf: (pid: number) => `start-${pid}` };
    const first = await acquireHeavyRunLock({
      projectRoot: root,
      label: 'paqad-ai checks run',
      lockPath,
      pid: 101,
      agentId: 'agent-a',
      session: 's1',
      probe: alive,
    });
    const told: string[] = [];
    let polls = 0;
    const second = acquireHeavyRunLock({
      projectRoot: root,
      label: 'full suite',
      lockPath,
      pid: 202,
      agentId: 'agent-b',
      probe: alive,
      pollMs: 1,
      sleep: async () => {
        polls += 1;
        if (polls === 3) first.release();
      },
      onWait: (holder) => told.push(describeHeavyRunHolder(holder)),
    });
    const lease = await second;
    expect(told).toEqual([`paqad-ai checks run (pid 101, agent agent-a, project ${root})`]);
    expect(polls).toBe(3);
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(202);
    lease.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('AC-29 reclaims a dead holder or one whose start time differs and writes a reclaim row', async () => {
    const root = tempRoot();
    const lockPath = join(root, 'locks', 'heavy-run.json');
    mkdirSync(join(root, 'locks'), { recursive: true });
    const dead: HeavyRunHolder = {
      pid: 999_999,
      start_time: 'then',
      agent_id: 'gone-agent',
      session: 's0',
      project: root,
      label: 'checks',
    };
    writeFileSync(lockPath, JSON.stringify(dead));
    const reclaimed: HeavyRunHolder[] = [];
    const lease = await acquireHeavyRunLock({
      projectRoot: root,
      label: 'checks',
      lockPath,
      pid: 5,
      probe: { startTimeOf: (pid) => (pid === 5 ? 'now' : null) },
      onReclaim: (holder) => reclaimed.push(holder),
    });
    expect(reclaimed.map((holder) => holder.pid)).toEqual([999_999]);
    lease.release();

    writeFileSync(lockPath, JSON.stringify({ ...dead, pid: 7, start_time: 'old-start' }));
    const restarted = await acquireHeavyRunLock({
      projectRoot: root,
      label: 'checks',
      lockPath,
      pid: 5,
      probe: { startTimeOf: (pid) => (pid === 7 ? 'new-start' : 'now') },
      onReclaim: (holder) => reclaimed.push(holder),
    });
    expect(reclaimed.map((holder) => holder.pid)).toEqual([999_999, 7]);
    restarted.release();

    const dir = openChange(root, 'ses-lock');
    recordHeavyRunReclaim(root, 'ses-lock', dir, dead);
    const row = readFeatureStageUnit(root, dir).find((r) => r.kind === 'heavy_run_reclaim');
    expect(row).toMatchObject({
      holder_pid: 999_999,
      agent_id: 'gone-agent',
      session_id: 'ses-lock',
    });
    expect(typeof row?.recorded_at).toBe('string');
  });

  it('AC-29 never takes over a lock held by a live slow run', async () => {
    const root = tempRoot();
    const lockPath = join(root, 'locks', 'heavy-run.json');
    mkdirSync(join(root, 'locks'), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 7, start_time: 'same', project: root, label: 'slow suite' }),
    );
    let clock = 0;
    await expect(
      acquireHeavyRunLock({
        projectRoot: root,
        label: 'checks',
        lockPath,
        pid: 5,
        probe: { startTimeOf: (pid) => (pid === 7 ? 'same' : 'now') },
        waitMs: 50,
        nowMs: () => clock,
        sleep: async () => {
          clock += 20;
        },
      }),
    ).rejects.toThrow(/slow suite/);
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(7);
  });

  it('AC-12 ends a stopped agent run it recorded and leaves other agents alone', async () => {
    await asPlatform('linux', async () => {
      const root = tempRoot();
      const home = tempRoot();
      writeAgentRunRecord(
        root,
        {
          pid: 41,
          start_time: 's41',
          pgid: 41,
          agent_id: 'agent-a',
          session: 's',
          label: 'checks',
        },
        home,
      );
      writeAgentRunRecord(
        root,
        {
          pid: 42,
          start_time: 's42',
          pgid: 42,
          agent_id: 'agent-b',
          session: 's',
          label: 'checks',
        },
        home,
      );
      const signals: Array<[number, string | number]> = [];
      const ended = await endAgentRuns(root, 'agent-a', {
        home,
        startTimeOf: (pid) => `s${pid}`,
        pgidOf: (pid) => (pid === process.pid || pid === process.ppid ? 1 : pid),
        signal: (target, signal) => {
          signals.push([target, signal]);
          return signal !== 0;
        },
        sleep: async () => {},
      });
      expect(ended.map((run) => run.pid)).toEqual([41]);
      expect(signals[0]).toEqual([-41, 'SIGTERM']);
      expect(signals.every(([target]) => target === -41)).toBe(true);
      expect(readAgentRunRecords(root, home).map((record) => record.pid)).toEqual([42]);
    });
  });

  it('AC-12 AC-30 never signals a group the record does not prove, nor a record an agent can write', async () => {
    const root = tempRoot();
    const home = tempRoot();
    const record = { start_time: 's', agent_id: 'agent-a', session: 's', label: 'checks' };
    writeAgentRunRecord(root, { ...record, pid: 51, pgid: 999 }, home);
    writeAgentRunRecord(root, { ...record, pid: 52, pgid: 52 }, home);
    writeAgentRunRecord(root, { ...record, pid: 53, pgid: 53 }, home);
    const loose = join(home, '.paqad-ai', 'runs');
    execFileSync('chmod', ['644', join(readdirOne(loose), '53.json')]);
    mkdirSync(join(root, '.paqad/checks/running/processes'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/checks/running/processes/54.json'),
      JSON.stringify({ ...record, pid: 54, pgid: 54, project: root }),
    );
    const signals: number[] = [];
    const ended = await endAgentRuns(root, 'agent-a', {
      home,
      startTimeOf: () => 's',
      pgidOf: (pid) => (pid === 51 ? 51 : pid === 52 ? 52 : pid === 53 ? 53 : pid === 54 ? 54 : 1),
      protectedGroups: [52],
      signal: (target) => {
        signals.push(target);
        return false;
      },
      sleep: async () => {},
    });
    expect(ended).toEqual([]);
    expect(signals).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'AC-30 ends the whole process group of a stopped agent run within 5 seconds',
    async () => {
      const root = tempRoot();
      const script =
        "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
        "process.stdout.write(String(c.pid)+'\\n');setInterval(()=>{},1000);";
      const parent = spawn(process.execPath, ['-e', script], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const workerPid = await new Promise<number>((resolve) => {
        parent.stdout!.once('data', (chunk: Buffer) => resolve(Number.parseInt(String(chunk), 10)));
      });
      const pid = parent.pid!;
      expect(processGroupOf(workerPid)).toBe(pid);
      const home = tempRoot();
      writeAgentRunRecord(
        root,
        {
          pid,
          start_time: processStartTime(pid)!,
          pgid: pid,
          agent_id: 'agent-suite',
          session: null,
          label: 'full suite',
        },
        home,
      );
      const started = Date.now();
      await endAgentRuns(root, 'agent-suite', { home });
      while ((liveProcess(pid) || liveProcess(workerPid)) && Date.now() - started < 5_000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(liveProcess(workerPid)).toBe(false);
      expect(liveProcess(pid)).toBe(false);
      expect(Date.now() - started).toBeLessThan(5_000);
    },
    10_000,
  );
});
