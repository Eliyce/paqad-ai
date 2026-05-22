# Pack System

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `pack-system`

## Purpose

Declarative `pack.yaml` packs that bind a stack to its detection
signals, docs, MCP config, and security mappings. Ships 19 framework
packs + 3 archetype packs and supports global + project-scoped
overrides with deterministic precedence.

## Source Footprint

- `src/packs`

## Features

- [Pack Schema (pack.yaml)](../features/pack-schema/business.md)
- [22 Built-in Packs](../features/built-in-packs/business.md)
- [Override Precedence](../features/pack-overrides/business.md)
- [Custom Pack Authoring](../features/pack-authoring/business.md)

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
