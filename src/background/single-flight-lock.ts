import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LockOutcome } from './types.js';

export function tryAcquireLock(
  lockDir: string,
  options: { staleLockMs: number; now?: () => number },
): LockOutcome {
  const now = options.now ?? Date.now;
  try {
    mkdirSync(dirname(lockDir), { recursive: true });
  } catch {}

  try {
    mkdirSync(lockDir);
    return { acquired: true, reclaimedStale: false };
  } catch {}

  let ageMs: number;
  try {
    ageMs = now() - statSync(lockDir).mtimeMs;
  } catch {
    return retryAcquire(lockDir, true);
  }

  if (ageMs <= options.staleLockMs) {
    return { acquired: false };
  }

  try {
    rmdirSync(lockDir);
  } catch {
    return { acquired: false };
  }
  return retryAcquire(lockDir, true);
}

export function releaseLock(lockDir: string): void {
  try {
    rmdirSync(lockDir);
  } catch {}
}

function retryAcquire(lockDir: string, reclaimedStale: boolean): LockOutcome {
  try {
    mkdirSync(lockDir);
    return { acquired: true, reclaimedStale };
  } catch {
    return { acquired: false };
  }
}
