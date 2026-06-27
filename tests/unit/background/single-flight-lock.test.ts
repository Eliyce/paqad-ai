import { existsSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';

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
      // Age the lock well past the stale threshold.
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
      const recent = Date.now() / 1000 - 1; // 1s old, threshold 60s
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
      utimesSync(lockDir, stamp, stamp); // mtime = 1_000_000s

      // now = stamp*1000 + 30s of ms → 30s old, below 60s threshold → not stale.
      const held = tryAcquireLock(lockDir, {
        staleLockMs: STALE,
        now: () => stamp * 1000 + 30_000,
      });
      expect(held).toEqual({ acquired: false });

      // now = stamp*1000 + 90s → 90s old → stale → reclaimed.
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
