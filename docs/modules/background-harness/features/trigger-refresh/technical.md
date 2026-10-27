# Trigger Refresh — Technical View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `trigger-refresh`

## Module Boundaries

- `src/background/worker-harness.ts` — `triggerRefresh`, `runRefreshJob`, `spawnDetachedWorker`.
- `src/background/types.ts` — `RefreshJobSpec`, `WorkerCommand`, `TriggerResult`, `TriggerDeps`.
- `src/background/refresh-context-lock.ts` — the context-refresh lock shared by the hook and
  the CLI (its own tsup entry, `dist/background/refresh-context-lock.js`).
- `runtime/hooks/agent-entry-prompt-gate.mjs` — decides whether a prompt may trigger the
  context refresh.
- `runtime/hooks/context-refresh-trigger.mjs` — debounce, lock, spawn and priority.
- `src/cli/commands/rag.ts` (`rag refresh-context`) — holds the lock for the whole run.

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

### Context refresh on prompt

1. `agent-entry-prompt-gate.mjs` calls `fireContextRefresh` in both the fresh and the
   not-fresh sentinel branch, but only when the prompt is non-empty and
   `isSystemNotificationPrompt` (`dist/pipeline/prompt-lane.js`, the same check ticket intake
   uses) does not flag it. That helper flags the system-notification banner, the
   `task-notification` / `ci-monitor-event` / `background-task-notification` elements, a
   subagent hand-back and a prompt that starts with `Stop hook feedback:` (only the leading
   form). When the dist import fails the refresh is skipped, the failure goes to
   `hook-failures.log` and the prompt goes on as normal.
2. `context-refresh-trigger.mjs` checks the debounce marker
   `.paqad/locks/rule-context.marker` (`DEBOUNCE_MS = 120_000`), stamps it, then calls
   `takeRefreshContextLock` on `.paqad/locks/refresh-context.lock` (`tryAcquireLock`, stale
   after 10 minutes). A held lock means no spawn.
3. It spawns `dist/cli/index.js rag refresh-context` detached with
   `PAQAD_REFRESH_CONTEXT_LOCK_HELD=1`, calls `os.setPriority(child.pid, 10)` in a
   try/catch (below-normal priority on Windows; an `EPERM` is ignored), and appends
   `context-refresh-trigger spawn reason=<lock-free|stale-lock-reclaimed> session=<id> count=1`
   to `.paqad/logs/hooks.log`. The trigger process stays alive until the child exits and
   releases the lock when the spawn fails or the child exits non-zero or by a signal.
4. `rag refresh-context` calls `holdRefreshContextLock`. Started by the trigger (the env
   flag) it adopts the lock; run by hand it takes the lock itself and prints
   `another refresh-context is running; skipped` when it is held. It renews the lock's
   mtime every minute, so a run longer than the 10-minute stale window is never reclaimed,
   and releases it in a `finally`, on process exit and on `SIGINT` / `SIGTERM`.

## State Management

- The single-flight lock is acquired by the parent and released by the worker
  (`runRefreshJob`'s `finally`), so the lock's lifetime spans the worker run.
- The debounce marker is stamped before the spawn so a racing burst still coalesces
  and a spawn failure does not leave a misleadingly "fresh" marker.

## Failure Modes

- Spawn throws → `releaseLock(spec.lockDir)` then rethrow.
- Worker crash → lock left behind; reclaimed by the next trigger once older than `staleLockMs`.
  The context refresh avoids that wait: its trigger releases the lock when the child crashes.

## Tests

- `tests/unit/hooks/agent-entry-prompt-gate-refresh.test.ts` — no refresh for a task
  notification, a hand-back or `Stop hook feedback:`, a refresh for a human prompt, and a
  skipped refresh with dist missing.
- `tests/unit/runtime/context-refresh-trigger.test.ts` — debounce, held and stale lock,
  crash and failed-spawn release, priority 10 and a swallowed `EPERM`, the hooks.log line.
- `tests/unit/background/refresh-context-lock.test.ts` — take, adopt, renew and release.

- `tests/unit/background/worker-harness.test.ts` — spawn-and-return, single-flight,
  debounce coalescing, stale-lock reclaim, spawn-failure release, the ~10ms budget,
  and `runRefreshJob` lock release on success and on throw.
