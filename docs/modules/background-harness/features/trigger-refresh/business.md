# Trigger Refresh — Business View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `trigger-refresh`

## Overview

`triggerRefresh` is the parent-side entry point a prompt or edit hook calls to
keep a precomputed artifact fresh without ever blocking the developer. It makes
a fast decision — coalesce, skip, or spawn — and returns immediately. The heavy
work (embedding, indexing, memory consolidation) happens in a detached worker it
launches, never inline.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **paqad-ai contributor** — wires a new background-maintained artifact (rules
  manifest, vector index, codebase memory) onto the harness.
- **Downstream module** — calls `triggerRefresh` from a hook and trusts the
  "never block" guarantee.

## User Flows

- **Trigger on prompt:** a `UserPromptSubmit` hook calls `triggerRefresh(spec)`.
  - Within the debounce window of the last spawn → coalesced (`{spawned:false, reason:'debounced'}`).
  - A worker already running (lock held) → no-op (`{spawned:false, reason:'in-flight'}`).
  - Otherwise → stamps the debounce marker, spawns the detached worker, returns `{spawned:true}`.

## Business Rules

- The call must stay well under the hook time budget (~10ms); it does only fast
  sync filesystem checks plus a non-blocking spawn.
- At most one worker per job runs at a time (single-flight).
- A burst of triggers produces at most one spawn per debounce window.
- A failed spawn releases the lock so the job is never wedged.

## Triggers & Side Effects

- Creates/holds a single-flight lock directory for the job.
- Stamps the debounce marker file mtime.
- Spawns a detached, `unref`'d worker process.

## Error States

- Spawn failure: the lock is released and the error is surfaced to the caller
  (hooks wrap and stay silent so the session is never disrupted).

## Glossary

- *debounce window* — the period after a spawn during which new triggers are dropped.
- *single-flight* — only one in-flight worker per job; concurrent triggers no-op.
