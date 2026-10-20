# Module Map Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `module-map-engine`

## Purpose

Builds the business-language module map from codebase signals using
the documented precedence: user-provided → locked entries →
codebase-native containers → deterministic inference → LLM fallback.
Powers Stage 1 of the documentation workflow.

## Why the code works the way it does

- **`module-map/reconciler.ts`.** It only detects drift and never edits `module-map.yml`;
  approved changes go back through `src/module-decisions/apply.ts`. With no
  `module_health.source_roots` in the stack pack it stops with `blocked: source_roots_unknown`
  rather than guessing a root. It reads both `sources:` and `source_paths:`, because the file on
  disk and the registry type use different names. A bare folder path matches everything under
  it. Globs are matched by a small translator for the shapes the map uses (`src/foo/**`,
  `src/foo/*.ts`), because fast-glob does not expose picomatch's matcher. Unmatched files are
  grouped by folder so large repos give a manageable number of findings, and a folder whose path
  already appears in a proposed or accepted module decision is reported as a mismatch rather than
  an addition. A rename is reported as a remove plus an add, since no stack pack ships a public
  API extractor yet. The audit record is skipped when the report is not written, so in-memory
  test runs never grow the log.
- **`module-map/sensitivity.ts`.** A path in a `sensitivity: high` module floors the change to the
  full lane. It is a YAML read and a prefix match, never a model call. A missing map reads
  `normal`, so the floor only ever tightens and never blocks on its own.
- **`module-map/source-roots.ts`.** Packs are searched in priority order (project, global,
  built-in), and every loaded pack is tried when the requested ones declare nothing, so a project
  without a profile still gets an answer. A missing `module_health` block reads as blocked, never
  a silent default.
- **`introspection/`.** `readStackSnapshotSync` exists because `plan compile` is synchronous all
  the way down; like the async reader, a missing or corrupt snapshot reads `null`. `persist:
  false` lets a read-only caller such as the onboarding dry-run build a snapshot without writing
  to `.paqad/`.

## Source Footprint

- `src/module-map`
- `src/introspection`

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
