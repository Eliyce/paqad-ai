# Trigger Refresh — Technical View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `trigger-refresh`

## Module Boundaries

- `src/background/worker-harness.ts` — `triggerRefresh`, `runRefreshJob`, `spawnDetachedWorker`.
- `src/background/types.ts` — `RefreshJobSpec`, `WorkerCommand`, `TriggerResult`, `TriggerDeps`.

## Entry Points

- `triggerRefresh(spec: RefreshJobSpec, deps?: TriggerDeps): TriggerResult` — parent side, sync.
- `runRefreshJob(spec, build): Promise<void>` — worker side; runs `build`, then always releases the lock.
- `spawnDetachedWorker(worker: WorkerCommand): void` — default detached `spawn` + `unref`.

## Data Model / Schema

`RefreshJobSpec`: `{ jobId, lockDir, markerPath, debounceMs, staleLockMs, worker }`.
`WorkerCommand`: `{ modulePath, args?, env? }`.
`TriggerResult`: `{ spawned: true } | { spawned: false, reason: 'debounced' | 'in-flight' }`.

## API / Interface Contract

Decision order inside `triggerRefresh`:

1. `shouldDebounce(markerPath, debounceMs, now)` → `debounced`.
2. `tryAcquireLock(lockDir, { staleLockMs, now })` → on failure `in-flight`.
3. `touchMarker(markerPath, now)` then `spawnWorker(spec.worker)` → `spawned`.

`deps` injects `now()` and `spawnWorker()` for deterministic tests.

## State Management

- The single-flight lock is acquired by the parent and released by the worker
  (`runRefreshJob`'s `finally`), so the lock's lifetime spans the worker run.
- The debounce marker is stamped before the spawn so a racing burst still coalesces
  and a spawn failure does not leave a misleadingly "fresh" marker.

## Failure Modes

- Spawn throws → `releaseLock(spec.lockDir)` then rethrow.
- Worker crash → lock left behind; reclaimed by the next trigger once older than `staleLockMs`.

## Tests

- `tests/unit/background/worker-harness.test.ts` — spawn-and-return, single-flight,
  debounce coalescing, stale-lock reclaim, spawn-failure release, the ~10ms budget,
  and `runRefreshJob` lock release on success and on throw.
