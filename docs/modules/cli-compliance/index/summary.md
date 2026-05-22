# Spec Compliance Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-compliance`

## Purpose

Extract obligations from structured Markdown specs, check tests for
explicit evidence, generate failing Vitest skeletons, and validate
compliance indexes.

## Source Footprint

- `src/cli/commands/compliance.ts`
- `src/compliance`

## Features

- [compliance extract](../features/compliance-extract/business.md)
- [compliance check](../features/compliance-check/business.md)
- [compliance review](../features/compliance-review/business.md)
- [compliance skeleton](../features/compliance-skeleton/business.md)
- [compliance doctor](../features/compliance-doctor/business.md)
- [compliance boundary](../features/compliance-boundary/business.md)
- [compliance patterns](../features/compliance-patterns/business.md)

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
