import { spawn } from 'node:child_process';

import { shouldDebounce, touchMarker } from './debounce-marker.js';
import { releaseLock, tryAcquireLock } from './single-flight-lock.js';
import type { RefreshJobSpec, TriggerDeps, TriggerResult, WorkerCommand } from './types.js';

/**
 * Parent-side entry point: decide whether a background refresh is needed and, if
 * so, launch a detached worker — returning immediately either way. This is the
 * function a prompt/edit hook calls; it must stay cheap (target < ~10ms), so it
 * does only fast sync filesystem checks and a non-blocking spawn. It never does
 * the heavy work (embedding, indexing) itself.
 *
 * Decision order:
 *   1. Debounce — if a worker spawned within `debounceMs`, coalesce this trigger.
 *   2. Single-flight — if a worker is already running (lock held), no-op.
 *   3. Otherwise stamp the debounce marker and spawn the detached worker. The
 *      lock is released by the worker on completion (see {@link runRefreshJob}).
 */
export function triggerRefresh(spec: RefreshJobSpec, deps: TriggerDeps = {}): TriggerResult {
  const now = deps.now ?? Date.now;
  const spawnWorker = deps.spawnWorker ?? spawnDetachedWorker;

  if (shouldDebounce(spec.markerPath, spec.debounceMs, now)) {
    return { spawned: false, reason: 'debounced' };
  }

  const lock = tryAcquireLock(spec.lockDir, { staleLockMs: spec.staleLockMs, now });
  if (!lock.acquired) {
    return { spawned: false, reason: 'in-flight' };
  }

  // Open the debounce window before spawning so a burst that races us still
  // coalesces, and so a spawn failure does not leave a "fresh" marker lying.
  touchMarker(spec.markerPath, now);

  try {
    spawnWorker(spec.worker);
  } catch (error) {
    // Hand the lock back so a failed spawn doesn't wedge the job until it goes
    // stale, then surface the failure (hooks wrap this and stay silent).
    releaseLock(spec.lockDir);
    throw error;
  }

  return { spawned: true };
}

/**
 * Worker-side wrapper: run the actual artifact build, then always release the
 * single-flight lock so the next trigger can spawn again. The build should write
 * through {@link import('./atomic-artifact.js').buildAndSwap} so a reader never
 * sees a half-written artifact even if this process is killed mid-build.
 */
export async function runRefreshJob(
  spec: Pick<RefreshJobSpec, 'lockDir'>,
  build: () => Promise<void>,
): Promise<void> {
  try {
    await build();
  } finally {
    releaseLock(spec.lockDir);
  }
}

/**
 * Default detached spawn: a fire-and-forget Node child that outlives this
 * process and is fully decoupled from its stdio. Mirrors the proven pattern in
 * `runtime/hooks/silent-update.mjs` so the session is never blocked on it.
 */
export function spawnDetachedWorker(worker: WorkerCommand): void {
  const child = spawn(process.execPath, [worker.modulePath, ...(worker.args ?? [])], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: worker.env ? { ...process.env, ...worker.env } : process.env,
  });
  child.unref();
}
