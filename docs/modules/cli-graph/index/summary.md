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

## Why the code works the way it does

- **`routes.ts`.** The graph is extracted on the first `/api/graph` request, not at server start,
  and `invalidate()` clears it after a `.paqad/` change. A similarity request body is capped at
  1 MB.
- **`watcher.ts`.** Append-only logs that report builds and dashboard writes produce are ignored,
  because reacting to them would loop: build, append, change event, build again. A recursive watch
  that fails on an unusual filesystem degrades silently.
- **`import-scanner.ts`.** Only relative specifiers and the tsconfig `@/` alias are resolved, and an
  explicit `.js` extension is stripped because TypeScript sources import `.js` paths.
- **`similarity.ts`.** The pairwise comparison is O(N²) over the scoped chunks; at about 4,000
  chunks that is around 8 million operations, which is fine on ordinary hardware.

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
