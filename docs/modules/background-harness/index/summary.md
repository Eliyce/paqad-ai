# Background-Worker Harness

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `background-harness`

## Purpose

The "never block coding" keystone (RAG buildout F1). One reusable mechanism to
keep any precomputed artifact fresh in a detached worker while the prompt path
only ever reads the finished artifact: a debounce marker that coalesces a burst
of prompts, a single-flight `mkdir` lock that serialises workers and reclaims a
crashed worker's stale lock, a detached `spawn`/`unref` that returns in well
under the hook time budget, and a build-to-temp + atomic-rename swap so a reader
never sees a half-written artifact. Smart rule loading, the branch-aware vector
index sync, and the codebase-memory tier all ride on it.

## Source Footprint

- `src/background`

## Features

- [Trigger Refresh (debounce → single-flight → detached spawn)](../features/trigger-refresh/business.md)
- [Single-Flight Lock (mkdir + stale reclaim)](../features/single-flight-lock/business.md)
- [Debounce Marker (burst coalescing)](../features/debounce-marker/business.md)
- [Atomic Artifact Swap (build-to-temp + rename)](../features/atomic-artifact-swap/business.md)

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
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
