# Trigger Refresh: API View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `trigger-refresh`

No config key. The refresh is started by a hook; the CLI verb can also be run by hand.

## `paqad-ai rag refresh-context`

```text
paqad-ai rag refresh-context [--project-root <path>] [--quiet] [--session <id>]
```

- `--quiet`: print nothing (the background trigger uses it).
- `--session`: the host session the refresh was started for; its route is read.

It syncs the index, retrieves the slices and rebuilds the session context. It holds
`.paqad/locks/refresh-context.lock` for the whole run, renewing it every minute, and releases it
when it ends, on exit and on `SIGINT` or `SIGTERM`. Started by the trigger
(`PAQAD_REFRESH_CONTEXT_LOCK_HELD=1`) it adopts the lock the trigger took. Run by hand while
another run holds the lock, it prints `another refresh-context is running; skipped` and exits 0.

## Hook behaviour

- `agent-entry-prompt-gate.mjs` asks for a refresh on a non-empty human prompt. It does not for
  a system notification, a task or CI notification, a subagent hand-back or a prompt that starts
  with `Stop hook feedback:`. When the built code cannot be loaded the refresh is skipped and the
  failure goes to `.paqad/logs/hook-failures.log`.
- `context-refresh-trigger.mjs` skips the refresh when `.paqad/locks/rule-context.marker` is
  under 2 minutes old or the lock is held by a live run (a lock older than 10 minutes is
  reclaimed). Otherwise it stamps the marker, takes the lock and starts the refresh in the
  background at lower priority. It releases the lock when the start fails or the refresh fails.

## `.paqad/logs/hooks.log`

Each started refresh appends one line:

```text
context-refresh-trigger spawn reason=<lock-free|stale-lock-reclaimed> session=<id> count=1
```

A skipped refresh writes no line. A failed start goes to `hook-failures.log`.

## Library surface

- `triggerRefresh(spec, deps?)`, `runRefreshJob(spec, build)`, `spawnDetachedWorker(worker)` in
  `src/background/worker-harness.ts`.
- `takeRefreshContextLock`, `holdRefreshContextLock`, `releaseRefreshContextLock` and
  `REFRESH_CONTEXT_LOCK_HELD_ENV` in `src/background/refresh-context-lock.ts`.
