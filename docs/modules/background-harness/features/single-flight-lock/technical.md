# Single-Flight Lock — Technical View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `single-flight-lock`

## Module Boundaries

- `src/background/single-flight-lock.ts` — `tryAcquireLock`, `releaseLock`.
- `src/background/types.ts` — `LockOutcome`.

## Entry Points

- `tryAcquireLock(lockDir, { staleLockMs, now? }): LockOutcome`
- `releaseLock(lockDir): void`

## Data Model / Schema

`LockOutcome`: `{ acquired: true, reclaimedStale: boolean } | { acquired: false }`.
The lock is a directory at `lockDir`; its mtime is the liveness clock.

## API / Interface Contract

- Acquire is `mkdirSync(lockDir)` — atomic; throws if it already exists.
- On contention, `statSync(lockDir).mtimeMs` is compared to `now()`:
  - age `<= staleLockMs` → `{ acquired: false }` (live holder).
  - age `> staleLockMs` → `rmdirSync` + retry `mkdirSync` → `reclaimedStale: true`.
- `now` is injectable for deterministic staleness tests; defaults to `Date.now`.

## State Management

- The lock is held for the whole life of the spawned worker (acquired by the
  parent in `triggerRefresh`, released by the worker in `runRefreshJob`).

## Failure Modes

- `statSync` failing (lock vanished mid-check) → one clean retry acquire.
- `rmdirSync` failing during reclaim (another process won the race) → back off as live.

## Tests

- `tests/unit/background/single-flight-lock.test.ts` — free acquire, single-flight
  refusal, stale reclaim, not-yet-stale hold, injected-clock staleness, release frees, no-op release.
