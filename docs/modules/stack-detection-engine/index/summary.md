# Stack Detection Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `stack-detection-engine`

## Purpose

Lockfile-first detection of frameworks, traits, and archetypes across
9 ecosystems. Drives onboarding, refresh, docs, MCP config, and
security workflows from a single resolved stack profile.

## Source Footprint

- `src/detection`
- `src/core/stack-profile.ts`

## Features

- [Manifest & Lockfile Scanner](../features/manifest-scanner/business.md)
- [Archetype Resolution](../features/archetype-resolution/business.md)
- [Drift Tracking](../features/drift-tracking/business.md)

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
