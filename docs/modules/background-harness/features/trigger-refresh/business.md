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

- **Trigger on prompt (context refresh):** the `UserPromptSubmit` gate
  (`agent-entry-prompt-gate.mjs`) starts `context-refresh-trigger.mjs` only for a real
  human prompt. Task notifications, stage-agent hand-backs and a prompt that starts with
  `Stop hook feedback:` never trigger a refresh. The trigger then runs Check, Stamp,
  Acquire, Release:
  - **Check:** a refresh started in the last 2 minutes → skip (debounce).
  - **Stamp:** stamp the debounce marker.
  - **Acquire:** take the refresh lock. A refresh already running (lock held) → skip, so
    only one runs at a time.
  - **Release:** the refresh holds the lock for its whole run and releases it when it ends,
    including on error. A failed spawn or a crashed refresh releases it at once.
  - The refresh runs at low priority so it does not compete with the developer's tools.

## Business Rules

- The call must stay well under the hook time budget (~10ms); it does only fast
  sync filesystem checks plus a non-blocking spawn.
- At most one worker per job runs at a time (single-flight).
- A burst of triggers produces at most one spawn per debounce window.
- A failed spawn releases the lock so the job is never wedged.
- The context refresh never starts on a machine prompt, at most once per 2 minutes, never
  while another one runs, and always below normal priority. Each start adds one line to
  `.paqad/logs/hooks.log` with only a reason, the session id and a count.
- Skipping a refresh never blocks the prompt and never loosens a gate: the machine-prompt
  check only decides whether the refresh (and ticket intake) runs.

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
