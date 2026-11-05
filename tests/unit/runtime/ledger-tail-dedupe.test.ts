import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { withTailLock } from '../../../runtime/hooks/lib/ledger-tail-dedupe.mjs';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function target(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-tail-lock-'));
  dirs.push(dir);
  return join(dir, 'rows.jsonl');
}

function oldLockThatCannotBeRemoved(file: string): string {
  const lock = `${file}.lock`;
  mkdirSync(lock);
  writeFileSync(join(lock, 'keeps-rmdir-from-working'), '');
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  return lock;
}

describe('withTailLock', () => {
  it('stops at its ceiling and runs the work without the lock when a stale lock stays', () => {
    const file = target();
    oldLockThatCannotBeRemoved(file);
    const started = Date.now();
    expect(withTailLock(file, () => 'ran')).toBe('ran');
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 5_000);

  it('takes over a stale lock it can remove, and leaves nothing behind', () => {
    const file = target();
    const lock = `${file}.lock`;
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(withTailLock(file, () => 'ran')).toBe('ran');
    expect(() => mkdirSync(lock)).not.toThrow();
  });

  it('runs the work without the lock when a live lock outlasts the wait', () => {
    const file = target();
    mkdirSync(`${file}.lock`);
    const started = Date.now();
    expect(withTailLock(file, () => 'ran')).toBe('ran');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('runs the work again when the lock was taken over before the write', () => {
    const file = target();
    const lock = `${file}.lock`;
    let runs = 0;
    const result = withTailLock(file, (assertHeld: () => void) => {
      runs += 1;
      if (runs === 1) rmSync(lock, { recursive: true });
      assertHeld();
      return 'wrote';
    });
    expect(result).toBe('wrote');
    expect(runs).toBe(2);
    expect(existsSync(lock)).toBe(false);
  });

  it('does not reclaim a live lock younger than a minute, and takes one from a gone process', () => {
    const file = target();
    const lock = `${file}.lock`;
    mkdirSync(lock);
    const young = new Date(Date.now() - 3_000);
    utimesSync(lock, young, young);
    expect(withTailLock(file, () => 'ran')).toBe('ran');
    expect(existsSync(lock)).toBe(true);
    writeFileSync(join(lock, 'owner-999999-abc'), '');
    expect(withTailLock(file, () => 'ran')).toBe('ran');
    expect(existsSync(lock)).toBe(false);
  });
});
