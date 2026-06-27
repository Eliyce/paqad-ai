# Context Block Emit — Business View

> Module: **Context Injection Seam** (`context-seam`) · Layer: `framework-internals` · Feature slug: `context-block-emit`

## Overview

Once the seam has read content, it wraps it in a `[paqad-context]` block and a
`UserPromptSubmit` hook writes that block to stdout. Hosts that inject
`UserPromptSubmit` stdout into the model context (Claude Code, and any
provider with the same contract) then put paqad's context in front of the model
before the turn. The hook always exits cleanly and stays silent on any error, so
it can never break or stall a turn.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — sees relevant context already in front of the model without
  asking for it.
- **Host / provider** — runs the hook on prompt submit and forwards its stdout.

## User Flows

- **Emit on prompt:** `agent-entry-prompt-gate.sh` invokes the seam hook on every
  enabled prompt, ahead of the framework-load reminder.
  - paqad disabled → the hook is a pure no-op (no block, no contamination of an
    A/B OFF arm).
  - Artifact present → a `[paqad-context]` block is written to stdout.
  - Artifact absent / empty / over budget → nothing is written.

## Business Rules

- Emitting is purely a read; the hook never mutates project state.
- The block runs independent of sentinel freshness — context is helpful even
  before the framework is fully loaded on the first turn.
- When paqad is disabled the seam emits nothing, matching the issue #220
  "disabled == missing == today" guarantee.
- The hook always exits 0; failure means "no context," never a broken turn.

## Triggers & Side Effects

- Writes the `[paqad-context]` block to stdout. No other side effects.

## Error States

- Any error (bad artifact, missing helper, runtime fault) → emit nothing, exit 0.

## Glossary

- *`[paqad-context]` block* — the fenced stdout payload the host injects verbatim.
- *seam* — the read-and-emit channel; the single way precomputed context reaches the model.
