# Context Intelligence

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `context-intelligence`

## Purpose

AST-aware semantic loader, 4-tier budget optimizer, deduplication,
pure-regex turn summarizer, and per-tier stream truncator. Makes
every token count regardless of whether RAG is on.

## Source Footprint

- `src/context`
- `src/token-efficiency`

## Features

- [Semantic Loader](../features/semantic-loader/business.md)
- [Budget Optimizer (green→yellow→amber→red)](../features/budget-optimizer/business.md)
- [Artifact Deduplication](../features/deduplication/business.md)
- [Turn Summarizer](../features/turn-summarizer/business.md)
- [Stream Truncator](../features/stream-truncator/business.md)

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
