# Pack System

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `pack-system`

## Purpose

Declarative `pack.yaml` packs that bind a stack to its detection
signals, docs, MCP recommendations, and security mappings. Ships 19 framework
packs + 3 archetype packs and supports global + project-scoped
overrides with deterministic precedence.

## Source Footprint

- `src/packs`

## Features

- [Pack Schema (pack.yaml)](../features/pack-schema/business.md)
- [22 Built-in Packs](../features/built-in-packs/business.md)
- [Override Precedence](../features/pack-overrides/business.md)
- [Custom Pack Authoring](../features/pack-authoring/business.md)

## Why the code works the way it does

- **`compliance-packs.ts`.** A compliance pack is a separate kind from a stack pack: it has no
  detection fields, only a framework header and clause-to-gate mappings. Compliance packs live in
  their own roots so the stack loader never mistakes one for a stack pack with no manifest. They
  use the same built-in, global, project precedence. An invalid pack is quarantined with warnings
  and skipped, never thrown, so a bad mapping cannot break verification. Gate and obligation
  references are checked beyond the schema, because a misspelled gate would silently never be
  cited, which is worse than a loud quarantine.
- **`loader.ts`.** Folders starting with `_` or `.` hold shared assets or VCS data and are never
  treated as packs, so they do not raise a false load-failure event on every load. A quarantined
  pack records an event whose hash is over its `pack.yaml` bytes (or over its root path when there
  is no manifest), so an unchanged failure repeats the same hash for de-duplication. A test
  runner's `flag` parallel mode must carry a flag with `<processes>` exactly once, and the other
  modes must carry none.

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
