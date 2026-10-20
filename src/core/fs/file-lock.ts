import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';

import { sleepSync } from './atomic-rename.js';

export interface FileLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => void;
}

export class FileLockTimeoutError extends Error {
  constructor(lockDir: string, timeoutMs: number) {
    super(
      `could not take the lock ${lockDir} within ${timeoutMs} ms; another paqad process holds it. ` +
        'Retry the command; if no other paqad command is running, remove that directory.',
    );
    this.name = 'FileLockTimeoutError';
  }
}

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
