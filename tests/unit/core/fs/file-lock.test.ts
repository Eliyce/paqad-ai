import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireOwnedFileLock,
  FileLockLostError,
  FileLockTimeoutError,
  withFileLockSync,
  withOwnedFileLockSync,
} from '@/core/fs/file-lock.js';

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

describe('the owned file lock', () => {
  const stale = { timeoutMs: 100, staleMs: 1_000 };
  const aged = (lock: string) => {
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
  };

  it('tells a holder it lost the lock and never removes the new holder on release', () => {
    const lock = tempLock();
    const first = acquireOwnedFileLock(lock, stale);
    expect(() => first.assertHeld()).not.toThrow();
    aged(lock);
    const second = acquireOwnedFileLock(lock, stale);
    expect(() => first.assertHeld()).toThrow(FileLockLostError);
    first.release();
    expect(existsSync(lock)).toBe(true);
    expect(() => second.assertHeld()).not.toThrow();
    second.release();
    expect(existsSync(lock)).toBe(false);
  });

  it('renews the age when the holder checks, so a check just before a write is safe', () => {
    const lock = tempLock();
    const holder = acquireOwnedFileLock(lock, stale);
    aged(lock);
    holder.assertHeld();
    expect(() => acquireOwnedFileLock(lock, stale)).toThrow(FileLockTimeoutError);
    holder.release();
  });

  it('waits for a live holder, then times out, leaving its lock', () => {
    const lock = tempLock();
    const holder = acquireOwnedFileLock(lock, stale);
    expect(() =>
      withOwnedFileLockSync(lock, () => 'ran', { timeoutMs: 50, staleMs: 60_000 }),
    ).toThrow(FileLockTimeoutError);
    expect(() => holder.assertHeld()).not.toThrow();
    holder.release();
  });

  it('follows its lock to a new path', () => {
    const lock = tempLock();
    const moved = `${lock}-moved`;
    const holder = acquireOwnedFileLock(lock, stale);
    renameSync(lock, moved);
    expect(() => holder.assertHeld()).toThrow(FileLockLostError);
    holder.movedTo(moved).release();
    expect(existsSync(moved)).toBe(false);
  });

  it('takes over from a holder whose process is gone, at any age', () => {
    const lock = tempLock();
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'owner-999999-abc'), '');
    expect(withOwnedFileLockSync(lock, () => 'ran', { timeoutMs: 100, staleMs: 60_000 })).toBe(
      'ran',
    );
    expect(existsSync(lock)).toBe(false);
  });

  it('runs out its ceiling on an old lock that holds a file it does not know', () => {
    const lock = tempLock();
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'not-ours'), '');
    aged(lock);
    expect(() => acquireOwnedFileLock(lock, stale)).toThrow(FileLockTimeoutError);
    expect(existsSync(join(lock, 'not-ours'))).toBe(true);
  });
});
