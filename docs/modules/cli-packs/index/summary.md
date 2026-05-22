# Pack Management Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-packs`

## Purpose

Install, remove, validate, scaffold, and inspect stack packs (built-in,
global, or project-scoped overrides).

## Source Footprint

- `src/cli/commands/packs.ts`

## Features

- [packs list](../features/packs-list/business.md)
- [packs install](../features/packs-install/business.md)
- [packs remove](../features/packs-remove/business.md)
- [packs validate](../features/packs-validate/business.md)
- [packs create](../features/packs-create/business.md)

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
