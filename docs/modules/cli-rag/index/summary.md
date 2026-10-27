# RAG Index Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-rag`

## Purpose

Build, inspect, clear, and benchmark the optional hybrid RAG vector
index that augments agent retrieval.

## Source Footprint

- `src/cli/commands/rag.ts`

## Features

- [rag init](../features/rag-init/business.md)
- [rag rebuild](../features/rag-rebuild/business.md)
- [rag status](../features/rag-status/business.md)
- [rag clear](../features/rag-clear/business.md)
- [rag eval](../features/rag-eval/business.md)

## Why the code works the way it does

The reasons below are not obvious from `src/cli/commands/rag.ts`.

- `rag refresh-context` is the detached worker the prompt trigger spawns. It syncs the index first
  so retrieval reads the fresh one, keeps the code-knowledge index current whatever `rag_enabled`
  says (that index is deterministic), and is single-flight and quiet so a detached run prints
  nothing. It holds `.paqad/locks/refresh-context.lock` for its whole run (renewed every minute,
  released on exit), so two refreshes never overlap; a hand run prints that it skipped when
  another holds the lock. It passes `skipSync: true` to the slice gather, so the index is synced
  once per refresh, not a second time inside `retrieveForEval`.
- The real CLI process turns on the embedding-provider cache at start-up, so one command loads
  the local model once however many retrievals it runs. Hook processes never turn it on.
- The routed workflow decides what the session-context artifact carries: rules only for feature
  development, nothing for no workflow, and with no route yet the old behaviour (rules plus
  retrieval). It reads the route of the session the refresh was started for, not whichever session
  routed last.
- With RAG off, only the rule slice and the embedding-free existing-surface digest are composed:
  no sync, retrieval, memory or base-drift fetch, which keeps the default free of any provider.
- A broad working set is distilled into a context pack of line-range pointers instead of many
  bodies. The base-drift fetch is debounced and single-flight in the worker, so the prompt never
  waits on the network.
- The `used` row records what was actually injected, and only rows with `injected: true` count
  toward the total, so a dark retrieval stays visible without inflating it.
- `join` builds the index without rewriting the tracked profile or the local `.config`.
- `rag eval` builds the feature-off baseline itself, so no baseline file is needed, and a failed
  gate exits non-zero so CI blocks the merge.

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
