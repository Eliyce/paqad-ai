import { utimesSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { releaseLock, tryAcquireLock } from './single-flight-lock.js';
import type { LockOutcome } from './types.js';

export const REFRESH_CONTEXT_LOCK_STALE_MS = 10 * 60 * 1000;
export const REFRESH_CONTEXT_LOCK_RENEW_MS = 60 * 1000;
export const REFRESH_CONTEXT_LOCK_HELD_ENV = 'PAQAD_REFRESH_CONTEXT_LOCK_HELD';

const RELEASE_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

export function refreshContextLockDir(projectRoot: string): string {
  return join(projectRoot, PATHS.LOCKS_DIR, 'refresh-context.lock');
}

export function takeRefreshContextLock(projectRoot: string, now?: () => number): LockOutcome {
  return tryAcquireLock(refreshContextLockDir(projectRoot), {
    staleLockMs: REFRESH_CONTEXT_LOCK_STALE_MS,
    now,
  });
}

export function releaseRefreshContextLock(projectRoot: string): void {
  releaseLock(refreshContextLockDir(projectRoot));
}

export function renewRefreshContextLock(
  projectRoot: string,
  now: () => number = Date.now,
): boolean {
  const stamp = new Date(now());
  try {
    utimesSync(refreshContextLockDir(projectRoot), stamp, stamp);
    return true;
  } catch {
    return false;
  }
}

export interface RefreshContextLockHold {
  release(): void;
}

export interface HoldRefreshContextLockOptions {
  env?: NodeJS.ProcessEnv;
  renewMs?: number;
}

export function holdRefreshContextLock(
  projectRoot: string,
  options: HoldRefreshContextLockOptions = {},
): RefreshContextLockHold | null {
  const env = options.env ?? process.env;
  const inherited = env[REFRESH_CONTEXT_LOCK_HELD_ENV] === '1';
  if (inherited) {
    if (!renewRefreshContextLock(projectRoot)) takeRefreshContextLock(projectRoot);
  } else if (!takeRefreshContextLock(projectRoot).acquired) {
    return null;
  }

  const timer = setInterval(
    () => renewRefreshContextLock(projectRoot),
    options.renewMs ?? REFRESH_CONTEXT_LOCK_RENEW_MS,
  );
  timer.unref();

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    clearInterval(timer);
    process.removeListener('exit', release);
    for (const signal of RELEASE_SIGNALS) process.removeListener(signal, onSignal);
    releaseRefreshContextLock(projectRoot);
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    release();
    process.kill(process.pid, signal);
  };
  process.once('exit', release);
  for (const signal of RELEASE_SIGNALS) process.once(signal, onSignal);
  return { release };
}
