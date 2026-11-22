import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireHeavyRunLock,
  describeHeavyRunHolder,
  heavyRunHolderGone,
  parseHeavyRunHolder,
  recordAgentRun,
  recordHeavyRunReclaim,
} from '@/checks/heavy-run-lock.js';
import {
  agentRunRecordDir,
  checksRunningMarkerPath,
  endAgentRuns,
  liveChecksRunningMarker,
  processGroupOf,
  processStartTime,
  readAgentRunRecords,
  readChecksRunningMarker,
  writeAgentRunRecord,
  writeChecksRunningMarker,
} from '@/checks/running-marker.js';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-agent-runs-'));
  roots.push(dir);
  return dir;
}

const NO_SUCH_PID = 2_147_483_000;
const posix = process.platform !== 'win32';

const RECORD = { start_time: 's', agent_id: 'agent-a', session: 's', label: 'checks' };

describe('checks running marker probes', () => {
  it('AC-12 names an empty session id unknown and reads a null marker as none', () => {
    const root = tempDir();
    expect(basename(checksRunningMarkerPath(root, ''))).toBe('unknown.json');
    mkdirSync(join(root, '.paqad', 'checks', 'running'), { recursive: true });
    writeFileSync(checksRunningMarkerPath(root, 's'), 'null');
    expect(readChecksRunningMarker(root, 's')).toBeNull();
  });

  it.skipIf(!posix)(
    'AC-12 the default probes judge a real process by its pid and command line',
    () => {
      const root = tempDir();
      const marker = (pid: number) =>
        writeChecksRunningMarker(root, {
          pid,
          session_id: 's',
          change: null,
          started_at: new Date().toISOString(),
        });
      marker(process.pid);
      expect(liveChecksRunningMarker(root, 's')).toBeNull();
      marker(NO_SUCH_PID);
      expect(liveChecksRunningMarker(root, 's')).toBeNull();
      expect(liveChecksRunningMarker(root, 's', { isAlive: () => true })).toBeNull();
      marker(1);
      expect(
        liveChecksRunningMarker(root, 's', { commandOf: () => 'paqad-ai checks run' }),
      ).toEqual(expect.objectContaining({ pid: 1 }));
    },
  );
});

describe('process probes', () => {
  it.skipIf(!posix)('AC-30 reads nothing for a pid that is invalid or not running', () => {
    expect(processStartTime(0)).toBeNull();
    expect(processStartTime(1.5)).toBeNull();
    expect(processStartTime(NO_SUCH_PID)).toBeNull();
    expect(processGroupOf(NO_SUCH_PID)).toBeNull();
    expect(processStartTime(process.pid)).toEqual(expect.any(String));
  });
});

describe('agent run records', () => {
  it.skipIf(!posix)('AC-30 tightens a loose records folder and refuses a symlinked one', () => {
    const root = tempDir();
    const home = tempDir();
    const dir = agentRunRecordDir(root, home);
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    chmodSync(dir, 0o755);
    writeAgentRunRecord(root, { ...RECORD, pid: 61, pgid: 61 }, home);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const other = tempDir();
    const linkedHome = tempDir();
    const linkedDir = agentRunRecordDir(other, linkedHome);
    mkdirSync(join(linkedDir, '..'), { recursive: true });
    symlinkSync(tempDir(), linkedDir);
    expect(() => writeAgentRunRecord(other, { ...RECORD, pid: 62, pgid: 62 }, linkedHome)).toThrow(
      /is not a directory/,
    );
  });

  it.skipIf(!posix)(
    'AC-30 reads only well-formed, private records of this project from a private folder',
    () => {
      const root = tempDir();
      const home = tempDir();
      expect(readAgentRunRecords(root, home)).toEqual([]);
      writeAgentRunRecord(root, { ...RECORD, pid: 71, pgid: 71 }, home);
      const dir = agentRunRecordDir(root, home);
      writeFileSync(join(dir, 'notes.txt'), 'x', { mode: 0o600 });
      writeFileSync(join(dir, '72.json'), '{oops', { mode: 0o600 });
      writeFileSync(
        join(dir, '73.json'),
        JSON.stringify({ ...RECORD, pid: 73, pgid: 73, project: '/elsewhere' }),
        { mode: 0o600 },
      );
      writeFileSync(
        join(dir, '74.json'),
        JSON.stringify({ ...RECORD, pid: 75, pgid: 75, project: root }),
        { mode: 0o600 },
      );
      mkdirSync(join(dir, '76.json'));
      symlinkSync(join(dir, '71.json'), join(dir, '77.json'));
      expect(readAgentRunRecords(root, home).map((r) => r.pid)).toEqual([71]);
      chmodSync(dir, 0o755);
      expect(readAgentRunRecords(root, home)).toEqual([]);
      chmodSync(dir, 0o700);
      expect(readdirSync(dir)).toContain('71.json');
    },
  );

  it('AC-12 clears a record whose process restarted and kills a group that ignores SIGTERM', async () => {
    const root = tempDir();
    const home = tempDir();
    writeAgentRunRecord(root, { ...RECORD, pid: 81, pgid: 81, start_time: 'old' }, home);
    writeAgentRunRecord(root, { ...RECORD, pid: 82, pgid: 82 }, home);
    const signals: Array<[number, string | number]> = [];
    let slept = 0;
    const ended = await endAgentRuns(root, 'agent-a', {
      home,
      startTimeOf: (pid) => (pid === 81 ? 'new' : 's'),
      pgidOf: (pid) => (pid === 82 ? 82 : null),
      signal: (target, signal) => {
        signals.push([target, signal]);
        return true;
      },
      sleep: async () => {
        slept += 1;
      },
    });
    expect(ended.map((r) => r.pid)).toEqual([82]);
    expect(signals[0]).toEqual([-82, 'SIGTERM']);
    expect(signals.at(-1)).toEqual([-82, 'SIGKILL']);
    expect(slept).toBe(30);
    expect(readAgentRunRecords(root, home)).toEqual([]);
  });
});

describe('heavy-run lock edges', () => {
  it('AC-29 parses holder text defensively and describes a holder without an agent', () => {
    expect(parseHeavyRunHolder('{oops')).toBeNull();
    expect(parseHeavyRunHolder(JSON.stringify({ pid: 0, project: '/p' }))).toBeNull();
    expect(parseHeavyRunHolder(JSON.stringify({ pid: 3 }))).toBeNull();
    const bare = parseHeavyRunHolder(JSON.stringify({ pid: 3, project: '/p' }))!;
    expect(bare).toEqual({
      pid: 3,
      start_time: null,
      agent_id: null,
      session: null,
      project: '/p',
      label: 'heavy run',
    });
    expect(describeHeavyRunHolder(bare)).toBe('heavy run (pid 3, session unknown, project /p)');
    expect(describeHeavyRunHolder({ ...bare, session: 's9' })).toContain('session s9');
    expect(describeHeavyRunHolder(null)).toBe('another heavy run');
    expect(heavyRunHolderGone(bare, { startTimeOf: () => 'any' })).toBe(false);
  });

  it.skipIf(!posix)('AC-29 judges a holder by its real start time when no probe is given', () => {
    expect(
      heavyRunHolderGone({
        pid: NO_SUCH_PID,
        start_time: 'x',
        agent_id: null,
        session: null,
        project: '/p',
        label: 'l',
      }),
    ).toBe(true);
  });

  it('AC-12 takes the lock with the session from the environment and waits with the real clock', async () => {
    const lockPath = join(tempDir(), 'locks', 'heavy-run.json');
    vi.stubEnv('SE_SESSION', 'env-session');
    const first = await acquireHeavyRunLock({
      projectRoot: '/p',
      label: 'checks',
      lockPath,
      pid: 11,
      probe: { startTimeOf: () => 'same' },
    });
    expect(first.holder).toMatchObject({ agent_id: null, session: 'env-session' });
    const waited: unknown[] = [];
    const second = acquireHeavyRunLock({
      projectRoot: '/p',
      label: 'suite',
      lockPath,
      pid: 12,
      probe: { startTimeOf: () => 'same' },
      pollMs: 5,
      onWait: (holder) => waited.push(holder),
    });
    setTimeout(() => first.release(), 20);
    const lease = await second;
    expect(waited).toHaveLength(1);
    const clock = [0, 31 * 60 * 1000];
    await expect(
      acquireHeavyRunLock({
        projectRoot: '/p',
        label: 'late',
        lockPath,
        pid: 13,
        probe: { startTimeOf: () => 'same' },
        nowMs: () => clock.shift() ?? 0,
      }),
    ).rejects.toThrow(/waited 30 minutes for suite \(pid 12/);
    lease.release();
  });

  it('AC-29 skips a reclaim row without a change and swallows a ledger it cannot write', () => {
    const holder = parseHeavyRunHolder(JSON.stringify({ pid: 3, project: '/p' }))!;
    const root = tempDir();
    expect(() => recordHeavyRunReclaim(root, 's', null, holder)).not.toThrow();
    writeFileSync(join(root, '.paqad'), 'not a directory');
    expect(() => recordHeavyRunReclaim(root, 's', 'some-change', holder)).not.toThrow();
  });
});

describe('recording an agent run', () => {
  it('AC-30 records nothing without an agent id', () => {
    const root = tempDir();
    recordAgentRun(root, 's', 'checks');
    expect(readAgentRunRecords(root)).toEqual([]);
  });

  it.skipIf(!posix)('AC-30 records this process for the agent in the home folder', () => {
    const root = tempDir();
    vi.stubEnv('SE_AGENT_ID', ' agent-z ');
    recordAgentRun(root, 'ses-z', 'full suite');
    const [record] = readAgentRunRecords(root);
    expect(record).toMatchObject({
      pid: process.pid,
      agent_id: 'agent-z',
      session: 'ses-z',
      label: 'full suite',
    });
    expect(agentRunRecordDir(root).startsWith(homedir())).toBe(true);
  });

  it.skipIf(!posix)('AC-30 gives up quietly when the records folder cannot be made', () => {
    const root = tempDir();
    vi.stubEnv('SE_AGENT_ID', 'agent-z');
    const dir = agentRunRecordDir(root);
    mkdirSync(join(dir, '..'), { recursive: true });
    writeFileSync(dir, 'not a directory');
    expect(() => recordAgentRun(root, null, 'checks')).not.toThrow();
    rmSync(dir, { force: true });
  });
});

describe('platform fallbacks', () => {
  function asPlatform(platform: NodeJS.Platform, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...original, value: platform });
    try {
      run();
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  }

  it('AC-30 on Windows reads no group or command and only whether the pid is alive', () => {
    const root = tempDir();
    writeChecksRunningMarker(root, {
      pid: process.pid,
      session_id: 's',
      change: null,
      started_at: new Date().toISOString(),
    });
    asPlatform('win32', () => {
      expect(processGroupOf(process.pid)).toBeNull();
      expect(processStartTime(process.pid)).toBe('unknown');
      expect(processStartTime(NO_SUCH_PID)).toBeNull();
      expect(liveChecksRunningMarker(root, 's')).toBeNull();
    });
  });

  it('AC-12 AC-30 on Windows reads records whose mode bits NTFS cannot make private and ends the run', async () => {
    const root = tempDir();
    const home = tempDir();
    const path = writeAgentRunRecord(root, { ...RECORD, pid: 93, pgid: 93 }, home);
    chmodSync(path, 0o666);
    chmodSync(agentRunRecordDir(root, home), 0o777);
    asPlatform('linux', () => {
      expect(readAgentRunRecords(root, home)).toEqual([]);
    });
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' });
    try {
      expect(readAgentRunRecords(root, home).map((r) => r.pid)).toEqual([93]);
      const signals: Array<[number, string | number]> = [];
      const ended = await endAgentRuns(root, 'agent-a', {
        home,
        startTimeOf: () => 's',
        pgidOf: (pid) => (pid === 93 ? 93 : null),
        signal: (target, signal) => {
          signals.push([target, signal]);
          return signal !== 0;
        },
        sleep: async () => {},
      });
      expect(ended.map((r) => r.pid)).toEqual([93]);
      expect(signals[0]).toEqual([-93, 'SIGTERM']);
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
    expect(readAgentRunRecords(root, home)).toEqual([]);
  });

  it('AC-30 trusts the file owner when the platform has no user id', () => {
    const root = tempDir();
    const home = tempDir();
    writeAgentRunRecord(root, { ...RECORD, pid: 91, pgid: 91 }, home);
    const getuid = process.getuid;
    Object.defineProperty(process, 'getuid', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(readAgentRunRecords(root, home).map((r) => r.pid)).toEqual([91]);
    } finally {
      Object.defineProperty(process, 'getuid', {
        value: getuid,
        configurable: true,
        writable: true,
      });
    }
  });

  it.skipIf(!posix)(
    'AC-12 takes the lock in the home folder for this process by default',
    async () => {
      const lease = await acquireHeavyRunLock({ projectRoot: tempDir(), label: 'checks' });
      expect(lease.holder).toMatchObject({ pid: process.pid, start_time: expect.any(String) });
      lease.release();
    },
  );
});
