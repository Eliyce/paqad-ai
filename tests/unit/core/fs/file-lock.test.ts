import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileLockTimeoutError, withFileLockSync } from '@/core/fs/file-lock.js';

// Issue #639, Part 13: the blocking lock that keeps parallel High Table seats from losing a note.

const roots: string[] = [];
function tempLock(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-file-lock-'));
  roots.push(root);
  return join(root, 'locks', 'experts.lock');
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('withFileLockSync', () => {
  it('runs the section under the lock and releases it after', () => {
    const lock = tempLock();
    const seen = withFileLockSync(lock, () => existsSync(lock));
    expect(seen).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock when the section throws', () => {
    const lock = tempLock();
    expect(() =>
      withFileLockSync(lock, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('waits for a live holder and gives up at the deadline, never running the section', () => {
    const lock = tempLock();
    mkdirSync(lock, { recursive: true });
    let clock = Date.now();
    const sleeps: number[] = [];
    let ran = false;
    expect(() =>
      withFileLockSync(
        lock,
        () => {
          ran = true;
        },
        {
          timeoutMs: 100,
          staleMs: 60_000,
          retryMs: 25,
          now: () => clock,
          sleep: (ms) => {
            sleeps.push(ms);
            clock += ms;
          },
        },
      ),
    ).toThrow(FileLockTimeoutError);
    expect(ran).toBe(false);
    expect(sleeps.length).toBeGreaterThanOrEqual(4);
    expect(sleeps.every((ms) => ms === 25)).toBe(true);
    // The live holder's lock is left alone.
    expect(existsSync(lock)).toBe(true);
  });

  it('reclaims a lock a crashed holder left behind once it is stale', () => {
    const lock = tempLock();
    mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(withFileLockSync(lock, () => 'ran', { staleMs: 1000, timeoutMs: 1000 })).toBe('ran');
    expect(existsSync(lock)).toBe(false);
  });

  it('names the lock and what to do in the timeout message', () => {
    const error = new FileLockTimeoutError('/x/experts.lock', 15000);
    expect(error.name).toBe('FileLockTimeoutError');
    expect(error.message).toContain('/x/experts.lock');
    expect(error.message).toContain('15000 ms');
  });
});
