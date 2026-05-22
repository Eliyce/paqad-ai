# Project Graph Command

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-graph`

## Purpose

One-command WebGL map of modules, files, chunks, symbols, imports, and
similarity neighbours. Server, frontend, and layout worker all ship
inside the package.

## Source Footprint

- `src/cli/commands/graph.ts`
- `src/graph`
- `graph-ui`

## Features

- [Graph Server](../features/graph-server/business.md)
- [Graph UI (React 19 + Vite SPA)](../features/graph-ui/business.md)
- [Similarity & Intelligence Overlays](../features/similarity-overlay/business.md)

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
