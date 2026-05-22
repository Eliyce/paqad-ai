# Documentation Workflow

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `documentation-workflow`

## Purpose

The two-stage flow triggered by "create documentation" (Stage 1 —
foundation docs + module map) and "create module documentation"
(Stage 2 — per-module business + technical docs). Re-reads live
manifests, syncs the stored stack profile, then writes
`docs/instructions/**` and `docs/modules/**`.

## Source Footprint

- `runtime/base/skills/documentation-workflow`
- `src/stack-docs`
- `src/document`

## Features

- [Stage 1 — Foundation Docs](../features/foundation-stage/business.md)
- [Stage 2 — Module Docs](../features/module-stage/business.md)
- [Module Map Discovery](../features/module-map-discovery/business.md)
- [Differential Refresh](../features/differential-refresh/business.md)

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
