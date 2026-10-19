// A blocking, cross-process file lock for short read-modify-write sections (issue #639, Part 13).
//
// The High Table runs each expert in its own subagent, in parallel, and every one of them ends by
// running `paqad-ai spec pipeline experts notes`, which reads `experts.json`, merges its role in
// and writes it back. Two of those at once would lose a note. This lock serialises them across
// processes. It reuses the one atomic-directory lock paqad already has (`tryAcquireLock`, the
// single-flight lock the background refresh uses, with its stale-lock reclaim) and only adds the
// wait: retry with a short sleep until the lock is ours or the deadline passes. A holder that
// crashed leaves its directory behind; once it is older than `staleMs` the next waiter reclaims it.
//
// Synchronous on purpose: the run-store writers it guards are synchronous.

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';

import { sleepSync } from './atomic-rename.js';

export interface FileLockOptions {
  /** Give up after this long (ms). Default 15000. */
  timeoutMs?: number;
  /** A lock directory older than this (ms) is a crashed holder and is reclaimed. Default 10000. */
  staleMs?: number;
  /** Wait between attempts (ms). Default 20. */
  retryMs?: number;
  /** Clock seam for tests. */
  now?: () => number;
  /** Sleep seam for tests. */
  sleep?: (ms: number) => void;
}

/** Raised when the lock could not be taken before the deadline. */
export class FileLockTimeoutError extends Error {
  constructor(lockDir: string, timeoutMs: number) {
    super(
      `could not take the lock ${lockDir} within ${timeoutMs} ms; another paqad process holds it. ` +
        'Retry the command; if no other paqad command is running, remove that directory.',
    );
    this.name = 'FileLockTimeoutError';
  }
}

/**
 * Run `fn` while holding the lock at `lockDir` (a directory path), then release it, even when `fn`
 * throws. Throws {@link FileLockTimeoutError} when the lock cannot be taken in time, so a caller
 * never writes without it.
 */
export function withFileLockSync<T>(
  lockDir: string,
  fn: () => T,
  options: FileLockOptions = {},
): T {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 10_000;
  const retryMs = options.retryMs ?? 20;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const deadline = now() + timeoutMs;
  for (;;) {
    const outcome = tryAcquireLock(lockDir, { staleLockMs: staleMs, now });
    if (outcome.acquired) break;
    if (now() >= deadline) throw new FileLockTimeoutError(lockDir, timeoutMs);
    sleep(retryMs);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
}
