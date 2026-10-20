import { spawn } from 'node:child_process';

import { shouldDebounce, touchMarker } from './debounce-marker.js';
import { releaseLock, tryAcquireLock } from './single-flight-lock.js';
import type { RefreshJobSpec, TriggerDeps, TriggerResult, WorkerCommand } from './types.js';

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

  touchMarker(spec.markerPath, now);

  try {
    spawnWorker(spec.worker);
  } catch (error) {
    releaseLock(spec.lockDir);
    throw error;
  }

  return { spawned: true };
}

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

export function spawnDetachedWorker(worker: WorkerCommand): void {
  const child = spawn(process.execPath, [worker.modulePath, ...(worker.args ?? [])], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: worker.env ? { ...process.env, ...worker.env } : process.env,
  });
  child.unref();
}
