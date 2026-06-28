# Context Injection Seam

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `context-seam`

## Purpose

The session-time delivery channel for everything paqad wants in front of the
model (RAG buildout F2). A `UserPromptSubmit` hook reads a **precomputed**
context artifact off disk and emits it as a `[paqad-context]` block on stdout, so
the host injects it into the model context before the turn is planned. The seam
itself does no heavy work — only a stat + read of a finished artifact under a
hard time budget; the background-worker harness keeps that artifact fresh. Smart
rule loading (F4/F5), wired retrieval (F11/F13), stage gating (F14), and the
codebase-memory tier (F21) all ride on this one channel. A missing, empty,
disabled, or too-slow-to-read artifact emits nothing, so the agent falls back to
grep/read exactly as today.

## Source Footprint

- `runtime/scripts/context-seam.mjs`
- `runtime/hooks/context-seam-inject.mjs`
- `runtime/hooks/agent-entry-prompt-gate.mjs`

## Features

- [Budgeted Artifact Read (resolve + read + ceiling)](../features/budgeted-read/business.md)
- [Context Block Emit (`[paqad-context]` + hook wiring)](../features/context-block-emit/business.md)

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Background harness (keeps the artifact fresh): [`docs/modules/background-harness/index/summary.md`](../../background-harness/index/summary.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
