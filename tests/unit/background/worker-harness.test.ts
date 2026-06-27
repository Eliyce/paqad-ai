import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseLock } from '@/background/single-flight-lock.js';
import type { RefreshJobSpec, WorkerCommand } from '@/background/types.js';
import { runRefreshJob, triggerRefresh } from '@/background/worker-harness.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'paqad-bg-harness-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeSpec(overrides: Partial<RefreshJobSpec> = {}): RefreshJobSpec {
  return {
    jobId: 'test-job',
    lockDir: join(dir, 'locks', 'test-job.lock'),
    markerPath: join(dir, 'markers', 'test-job'),
    debounceMs: 0,
    staleLockMs: 60_000,
    worker: { modulePath: join(dir, 'worker.mjs') },
    ...overrides,
  };
}

describe('triggerRefresh', () => {
  it('spawns a detached worker and returns immediately', () => {
    const spec = makeSpec();
    const spawnWorker = vi.fn<(w: WorkerCommand) => void>();
    const result = triggerRefresh(spec, { spawnWorker });
    expect(result).toEqual({ spawned: true });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
    expect(spawnWorker).toHaveBeenCalledWith(spec.worker);
    expect(existsSync(spec.lockDir)).toBe(true); // lock held for the worker
  });

  it('no-ops a second concurrent trigger while a worker is in-flight (single-flight)', () => {
    const spec = makeSpec(); // debounce disabled, so only the lock can suppress
    const spawnWorker = vi.fn<(w: WorkerCommand) => void>();
    const first = triggerRefresh(spec, { spawnWorker });
    const second = triggerRefresh(spec, { spawnWorker });
    expect(first).toEqual({ spawned: true });
    expect(second).toEqual({ spawned: false, reason: 'in-flight' });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst within the debounce window after a worker finishes', () => {
    const spec = makeSpec({ debounceMs: 1000 });
    const spawnWorker = vi.fn<(w: WorkerCommand) => void>();
    const stamp = 5_000_000_000;

    // First trigger spawns and stamps the marker at `stamp`.
    const first = triggerRefresh(spec, { spawnWorker, now: () => stamp });
    // Worker finishes and releases the lock — so the lock no longer suppresses.
    releaseLock(spec.lockDir);

    // A second trigger 500ms later is dropped purely by debounce, not the lock.
    const second = triggerRefresh(spec, { spawnWorker, now: () => stamp + 500 });
    // A third trigger after the window spawns again.
    const third = triggerRefresh(spec, { spawnWorker, now: () => stamp + 1500 });

    expect(first).toEqual({ spawned: true });
    expect(second).toEqual({ spawned: false, reason: 'debounced' });
    expect(third).toEqual({ spawned: true });
    expect(spawnWorker).toHaveBeenCalledTimes(2);
  });

  it('reclaims a crashed worker’s stale lock and spawns again', () => {
    const spec = makeSpec();
    // Simulate a crashed worker: lock present, aged past the stale threshold.
    mkdirSync(spec.lockDir, { recursive: true });
    const old = Date.now() / 1000 - 3600;
    utimesSync(spec.lockDir, old, old);

    const spawnWorker = vi.fn<(w: WorkerCommand) => void>();
    const result = triggerRefresh(spec, { spawnWorker });
    expect(result).toEqual({ spawned: true });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and rethrows when the spawn itself fails', () => {
    const spec = makeSpec();
    const spawnWorker = vi.fn(() => {
      throw new Error('spawn boom');
    });
    expect(() => triggerRefresh(spec, { spawnWorker })).toThrow('spawn boom');
    // The lock must not be left wedged on a failed spawn.
    expect(existsSync(spec.lockDir)).toBe(false);
  });

  it('stays well under the hook→spawn time budget (~10ms)', () => {
    const spec = makeSpec();
    const spawnWorker = vi.fn<(w: WorkerCommand) => void>();
    const start = process.hrtime.bigint();
    triggerRefresh(spec, { spawnWorker });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(10);
  });
});

describe('runRefreshJob', () => {
  it('runs the build then releases the lock', async () => {
    const spec = makeSpec();
    mkdirSync(spec.lockDir, { recursive: true }); // worker owns the lock
    const build = vi.fn(async () => undefined);
    await runRefreshJob(spec, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(existsSync(spec.lockDir)).toBe(false);
  });

  it('releases the lock even when the build throws', async () => {
    const spec = makeSpec();
    mkdirSync(spec.lockDir, { recursive: true });
    await expect(
      runRefreshJob(spec, async () => {
        throw new Error('build failed');
      }),
    ).rejects.toThrow('build failed');
    expect(existsSync(spec.lockDir)).toBe(false);
  });
});
