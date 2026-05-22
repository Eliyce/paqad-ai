# Project Lifecycle Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-lifecycle`

## Purpose

The day-one and day-N commands that bootstrap, refresh, and upgrade
a project's framework footprint without re-running full onboarding.

## Source Footprint

- `src/cli/commands/install.ts`
- `src/cli/commands/onboard.ts`
- `src/cli/commands/refresh.ts`
- `src/cli/commands/update.ts`

## Features

- [paqad-ai install](../features/install/business.md)
- [paqad-ai onboard](../features/onboard/business.md)
- [paqad-ai refresh](../features/refresh/business.md)
- [paqad-ai update](../features/update/business.md)

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
