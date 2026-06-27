# Single-Flight Lock — Business View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `single-flight-lock`

## Overview

A best-effort lock that guarantees only one background worker per job runs at a
time, and that a crashed worker never wedges the job forever. It is a portable
`mkdir`-based lock — no `flock` — mirroring the proven pattern already used by
`silent-update.mjs` and the vector index.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **paqad-ai contributor** — relies on the lock to serialise an artifact's refresh.

## User Flows

- **Acquire:** `tryAcquireLock(lockDir)` creates the lock directory atomically.
  Success means the caller owns it and must release it.
- **Contend:** a second caller sees the directory exists and backs off (`acquired:false`).
- **Reclaim:** if the lock's mtime is older than the stale threshold (a crashed
  worker), it is removed and re-created in one attempt (`reclaimedStale:true`).
- **Release:** `releaseLock(lockDir)` removes the directory; safe when absent.

## Business Rules

- Exactly one holder at a time per `lockDir`.
- A lock is reclaimed only once it ages past `staleLockMs` — a live-but-slow
  worker is never pre-empted.
- Release is idempotent and never throws.

## Triggers & Side Effects

- Creates / removes the lock directory and its parent.

## Error States

- Filesystem errors during reclaim are treated as "held by a live worker" — the
  caller backs off rather than risking a double run.

## Glossary

- *stale lock* — a lock left by a crashed worker, identified by its age.
