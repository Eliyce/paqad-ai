import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LockOutcome } from './types.js';

/**
 * Best-effort single-flight lock via atomic directory creation (portable; no
 * `flock` needed — mirrors `silent-update.mjs` and `vector-index.ts`). Only one
 * holder can create `lockDir`; everyone else sees it already exists and backs
 * off. The lock is held for the whole life of the spawned worker and released
 * by it on completion, so while a refresh runs every new trigger no-ops.
 *
 * A worker that crashes leaves the directory behind. To avoid a permanently
 * stuck job, a lock whose mtime is older than `staleLockMs` is reclaimed: it is
 * removed and re-created in one attempt. `now` is injectable for deterministic
 * tests.
 *
 * @returns `{ acquired: true, reclaimedStale }` on success (the caller now owns
 *   the lock and must release it), or `{ acquired: false }` when a live holder
 *   already has it.
 */
export function tryAcquireLock(
  lockDir: string,
  options: { staleLockMs: number; now?: () => number },
): LockOutcome {
  const now = options.now ?? Date.now;
  try {
    mkdirSync(dirname(lockDir), { recursive: true });
  } catch {
    // Parent dir may already exist or be unwritable; the mkdir below decides.
  }

  try {
    mkdirSync(lockDir); // atomic: throws if it already exists
    return { acquired: true, reclaimedStale: false };
  } catch {
    // Held by someone. Reclaim only if it has aged past the stale threshold.
  }

  let ageMs: number;
  try {
    ageMs = now() - statSync(lockDir).mtimeMs;
  } catch {
    // The lock vanished between our mkdir and stat — retry once cleanly.
    return retryAcquire(lockDir, true);
  }

  if (ageMs <= options.staleLockMs) {
    return { acquired: false };
  }

  try {
    rmdirSync(lockDir);
  } catch {
    // Another process reclaimed it first; treat as live and back off.
    return { acquired: false };
  }
  return retryAcquire(lockDir, true);
}

/** Release a lock acquired via {@link tryAcquireLock}. Safe to call when absent. */
export function releaseLock(lockDir: string): void {
  try {
    rmdirSync(lockDir);
  } catch {
    // Already gone (reclaimed as stale, or never held) — nothing to do.
  }
}

function retryAcquire(lockDir: string, reclaimedStale: boolean): LockOutcome {
  try {
    mkdirSync(lockDir);
    return { acquired: true, reclaimedStale };
  } catch {
    return { acquired: false };
  }
}
