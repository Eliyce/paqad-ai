import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  releaseLock,
  tryAcquireFileLock,
  tryAcquireLock,
  UNPARSEABLE_LOCK_GRACE_MS,
} from '@/background/single-flight-lock.js';

import { withTempDir } from '../skills/_helpers/temp-fs.js';

const STALE = 60_000;

describe('tryAcquireLock', () => {
  it('acquires a free lock and creates its parent directory', () => {
    withTempDir((dir) => {
      const lockDir = join(dir, 'locks', 'job.lock');
      const outcome = tryAcquireLock(lockDir, { staleLockMs: STALE });
      expect(outcome).toEqual({ acquired: true, reclaimedStale: false });
      expect(existsSync(lockDir)).toBe(true);
    });
  });

  it('refuses a lock a live holder already owns (single-flight)', () => {
    withTempDir((dir) => {
      const lockDir = join(dir, 'job.lock');
      const first = tryAcquireLock(lockDir, { staleLockMs: STALE });
      const second = tryAcquireLock(lockDir, { staleLockMs: STALE });
      expect(first.acquired).toBe(true);
      expect(second).toEqual({ acquired: false });
    });
  });

  it('reclaims a stale lock left by a crashed worker', () => {
    withTempDir((dir) => {
      const lockDir = join(dir, 'job.lock');
      mkdirSync(lockDir, { recursive: true });
      const old = Date.now() / 1000 - 3600;
      utimesSync(lockDir, old, old);

      const outcome = tryAcquireLock(lockDir, { staleLockMs: STALE });
      expect(outcome).toEqual({ acquired: true, reclaimedStale: true });
      expect(existsSync(lockDir)).toBe(true);
    });
  });

  it('does not reclaim a lock that is held but not yet stale', () => {
    withTempDir((dir) => {
      const lockDir = join(dir, 'job.lock');
      mkdirSync(lockDir, { recursive: true });
      const recent = Date.now() / 1000 - 1;
      utimesSync(lockDir, recent, recent);

      const outcome = tryAcquireLock(lockDir, { staleLockMs: STALE });
      expect(outcome).toEqual({ acquired: false });
    });
  });

  it('uses the injected clock to judge staleness deterministically', () => {
    withTempDir((dir) => {
      const lockDir = join(dir, 'job.lock');
      mkdirSync(lockDir, { recursive: true });
      const stamp = 1_000_000;
      utimesSync(lockDir, stamp, stamp);

      const held = tryAcquireLock(lockDir, {
        staleLockMs: STALE,
        now: () => stamp * 1000 + 30_000,
      });
      expect(held).toEqual({ acquired: false });

      const reclaimed = tryAcquireLock(lockDir, {
        staleLockMs: STALE,
        now: () => stamp * 1000 + 90_000,
      });
      expect(reclaimed).toEqual({ acquired: true, reclaimedStale: true });
    });
  });
});

describe('releaseLock', () => {
  it('frees a held lock so the next acquire succeeds', () => {
    withTempDir((dir) => {
      const lockDir = join(dir, 'job.lock');
      tryAcquireLock(lockDir, { staleLockMs: STALE });
      releaseLock(lockDir);
      expect(existsSync(lockDir)).toBe(false);
      expect(tryAcquireLock(lockDir, { staleLockMs: STALE }).acquired).toBe(true);
    });
  });

  it('is a no-op when no lock is held', () => {
    withTempDir((dir) => {
      expect(() => releaseLock(join(dir, 'absent.lock'))).not.toThrow();
    });
  });
});

describe('tryAcquireFileLock reclaim (AC-29)', () => {
  interface Holder {
    pid: number;
  }
  const parse = (text: string): Holder | null => {
    try {
      const value = JSON.parse(text) as Holder;
      return Number.isInteger(value.pid) ? value : null;
    } catch {
      return null;
    }
  };

  it('AC-29 reclaims an unparseable lock file once it is older than the grace, never sooner', () => {
    withTempDir((dir) => {
      const path = join(dir, 'locks', 'heavy.json');
      mkdirSync(join(dir, 'locks'));
      writeFileSync(path, '');
      const written = Date.now();
      const young = tryAcquireFileLock(path, {
        body: { pid: 1 },
        parse,
        holderGone: () => true,
        now: () => written + 1_000,
      });
      expect(young).toEqual({ acquired: false, holder: null });
      const old = tryAcquireFileLock(path, {
        body: { pid: 1 },
        parse,
        holderGone: () => true,
        now: () => written + UNPARSEABLE_LOCK_GRACE_MS + 5_000,
      });
      expect(old.acquired).toBe(true);
      expect(parse(readFileSync(path, 'utf8'))).toEqual({ pid: 1 });
    });
  });

  it('AC-29 lets only one of two waiters win when both judge the old holder gone', () => {
    withTempDir((dir) => {
      const path = join(dir, 'heavy.json');
      writeFileSync(path, JSON.stringify({ pid: 9 }));
      let first: ReturnType<typeof tryAcquireFileLock<Holder>> | null = null;
      const second = tryAcquireFileLock<Holder>(path, {
        body: { pid: 2 },
        parse,
        holderGone: () => {
          first = tryAcquireFileLock<Holder>(path, {
            body: { pid: 1 },
            parse,
            holderGone: (holder) => holder.pid === 9,
          });
          return true;
        },
      });
      expect(first).toMatchObject({ acquired: true, reclaimed: { pid: 9 } });
      expect(second).toEqual({ acquired: false, holder: { pid: 1 } });
      expect(parse(readFileSync(path, 'utf8'))).toEqual({ pid: 1 });
      expect(readdirSync(dir)).toEqual(['heavy.json']);
    });
  });
});
