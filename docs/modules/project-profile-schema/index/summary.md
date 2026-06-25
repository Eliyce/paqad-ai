# Project Profile & Onboarding Manifest

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `project-profile-schema`

## Purpose

The shape, defaults, and writers for `.paqad/project-profile.yaml`,
`.paqad/onboarding-manifest.json`, and the resolved
`project-intelligence` context that every other module reads.

The profile is now **lean — project facts only**: project name / id / description,
the project's own `commands`, `mcp.servers`, the detection-derived
`active_capabilities` and `stack_profile`, and the project-owned `custom` arrays.
Framework knobs (paqad on/off, enterprise, RAG, strictness, escalation, features,
research depth, model routing, decision tuning, version/update) no longer live
here. They come from code defaults in `src/core/framework-config.ts`, overridable
through the config layer — tracked team `.paqad/configs/.config.*`, git-ignored
local `.paqad/.config` (local wins), `PAQAD_*` env — and documented in the tracked
`.paqad/.config.example` catalog. See
[`config-visibility`](../../../instructions/rules/coding/config-visibility.md).

## Source Footprint

- `src/core/project-profile.ts`
- `src/core/project-intelligence.ts`
- `src/core/runtime-paths.ts`
- `src/onboarding/manifest-writer.ts`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

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
