import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REFRESH_CONTEXT_LOCK_HELD_ENV,
  REFRESH_CONTEXT_LOCK_STALE_MS,
  holdRefreshContextLock,
  refreshContextLockDir,
  takeRefreshContextLock,
} from '@/background/refresh-context-lock.js';

describe('refresh-context lock', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-refresh-lock-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('lives at .paqad/locks/refresh-context.lock', () => {
    expect(refreshContextLockDir(root)).toBe(join(root, '.paqad', 'locks', 'refresh-context.lock'));
  });

  it('FR-40: a hand run takes the lock for its whole run and releases it', () => {
    const hold = holdRefreshContextLock(root, { env: {} });
    expect(hold).not.toBeNull();
    expect(existsSync(refreshContextLockDir(root))).toBe(true);
    hold!.release();
    expect(existsSync(refreshContextLockDir(root))).toBe(false);
  });

  it('AC-57: a hand run skips while another refresh holds the lock', () => {
    expect(takeRefreshContextLock(root).acquired).toBe(true);
    expect(holdRefreshContextLock(root, { env: {} })).toBeNull();
    expect(existsSync(refreshContextLockDir(root))).toBe(true);
  });

  it('FR-40: a run started by the trigger adopts the lock the trigger took', () => {
    expect(takeRefreshContextLock(root).acquired).toBe(true);
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(refreshContextLockDir(root), old, old);
    const hold = holdRefreshContextLock(root, { env: { [REFRESH_CONTEXT_LOCK_HELD_ENV]: '1' } });
    expect(hold).not.toBeNull();
    expect(statSync(refreshContextLockDir(root)).mtimeMs).toBeGreaterThan(old.getTime());
    hold!.release();
    expect(existsSync(refreshContextLockDir(root))).toBe(false);
  });

  it('FR-40: a trigger-started run re-creates a lock that vanished', () => {
    const hold = holdRefreshContextLock(root, { env: { [REFRESH_CONTEXT_LOCK_HELD_ENV]: '1' } });
    expect(existsSync(refreshContextLockDir(root))).toBe(true);
    hold!.release();
  });

  it('AC-57: a run longer than 10 minutes renews the lock so it is never reclaimed', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const hold = holdRefreshContextLock(root, { env: {}, renewMs: 60_000 });
    vi.advanceTimersByTime(REFRESH_CONTEXT_LOCK_STALE_MS + 5 * 60_000);
    expect(takeRefreshContextLock(root, () => Date.now()).acquired).toBe(false);
    hold!.release();
    expect(takeRefreshContextLock(root).acquired).toBe(true);
  });

  it('FR-40: releases on process exit and drops its listeners once released', () => {
    const exitBefore = process.listenerCount('exit');
    const termBefore = process.listenerCount('SIGTERM');
    const hold = holdRefreshContextLock(root, { env: {} });
    expect(process.listenerCount('exit')).toBe(exitBefore + 1);
    expect(process.listenerCount('SIGTERM')).toBe(termBefore + 1);
    const onExit = process.listeners('exit').at(-1) as (code: number) => void;
    onExit(0);
    expect(existsSync(refreshContextLockDir(root))).toBe(false);
    hold!.release();
    expect(process.listenerCount('exit')).toBe(exitBefore);
    expect(process.listenerCount('SIGTERM')).toBe(termBefore);
  });

  it('release is idempotent and never removes a lock taken after it', () => {
    const hold = holdRefreshContextLock(root, { env: {} });
    hold!.release();
    mkdirSync(refreshContextLockDir(root), { recursive: true });
    hold!.release();
    expect(existsSync(refreshContextLockDir(root))).toBe(true);
  });
});
