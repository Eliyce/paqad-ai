# Budgeted Artifact Read — Business View

> Module: **Context Injection Seam** (`context-seam`) · Layer: `framework-internals` · Feature slug: `budgeted-read`

## Overview

The seam reads a single precomputed context artifact off disk and decides
whether there is anything safe to inject. It does so under a hard time budget and
a runaway-byte ceiling, so the prompt path is never slowed and a corrupt or
oversized artifact can never dump unbounded text into the model context.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **paqad-ai contributor** — points an upstream producer (rule manifest,
  retrieval, memory) at the artifact path the seam reads.
- **Downstream feature** — relies on "whatever is in the artifact reaches the
  model, cheaply and without blocking."

## User Flows

- **Read on prompt:** the hook resolves the artifact path and reads it.
  - File missing / unreadable / not a regular file → nothing to inject.
  - File empty or whitespace-only → nothing to inject.
  - Stat or read overruns the time budget → nothing to inject (never stall).
  - Otherwise → trimmed content, truncated with a visible marker if above the
    byte ceiling.

## Business Rules

- The read is the only work the prompt path does for context — no embedding,
  indexing, or sync happens here (that is the background harness's job).
- Path defaults to `.paqad/context/session-context.md`; `PAQAD_CONTEXT_ARTIFACT`
  overrides it (absolute, or relative to the project root).
- The byte ceiling is a safety guard, not the token budget — upstream is
  responsible for keeping the artifact within a sane token size.
- "Nothing to inject" is a first-class, expected outcome (cold start == today).

## Triggers & Side Effects

- Reads one file. No writes, no network, no process spawn.

## Error States

- Any filesystem error is swallowed and treated as "nothing to inject"; the
  agent proceeds with grep/read.

## Glossary

- *artifact* — the precomputed context file the seam reads (kept fresh out of band).
- *time budget* — the deadline past which the seam emits nothing rather than block.
- *byte ceiling* — the maximum content length emitted; excess is truncated with a marker.
