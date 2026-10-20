# Repository Resolver

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `repository-resolver`

## Purpose

Detects the repository root, sub-projects (e.g. `graph-ui/` inside
this repo), and ecosystem markers. Used by detection, onboarding,
and the module-map engine.

## Source Footprint

- `src/repository`
- `src/resolver`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the code works the way it does

`discovery.ts` reads the tree into memory once, applying only the rules that need no git (dot
entries, the static ignore sets, nested VCS boundaries, where descent stops), then resolves every
git-ignored path with one batched `git check-ignore` call. Spawning two calls per folder used to
stall onboarding for seconds on large repos. The output matches the old per-folder walk.

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
