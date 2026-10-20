# Documentation Workflow

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `documentation-workflow`

## Purpose

The two-stage flow triggered by "create documentation" (Stage 1 —
foundation docs + module map) and "create module documentation"
(Stage 2 — per-module business + technical docs). Re-reads live
manifests, syncs the stored stack profile, then writes
`docs/instructions/**` and `docs/modules/**`.

## Why the code works the way it does

- **`document/workflow.ts`.** `module-map.yml` is written before module discovery, so the
  registries, architecture docs and tech-debt notes all use the business module names; module
  names named in the request are passed as strong hints. A module's evidence comes from the map's
  `source_paths` when it has them (a folder path expands to every source file under it, compared
  in posix form so Windows paths match), and slug matching is only the fallback, so unrelated
  files are never used. An explicitly empty `features` list means the user wants no features;
  discovery runs only when the list is absent. A doc is skipped only when its sources and its
  current content are both unchanged, since map edits and prompt hints can change the intended
  text. The design-system docs are not generated while the tokens file is still the placeholder,
  so they are never built from generic defaults. Delivery-convention detection rides the repo
  scan for the coding domain only and is best-effort, so a git-less or restricted environment
  never fails the run. With the analytics flag off (any config error counts as off) nothing about
  analytics is written.
- **`stack-docs/generator.ts`.** With the analytics flag on it writes `analytics.md`; with it off
  it writes nothing and removes a stale copy an earlier onboard left, and a failed cleanup never
  breaks onboarding.

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
