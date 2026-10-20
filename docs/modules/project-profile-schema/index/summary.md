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
through the config layer — tracked team `.paqad/configs/.config.*` (one
self-documenting file per group, every knob commented out at its default),
git-ignored local `.paqad/.config` (local wins), and `PAQAD_*` env. See
[`config-visibility`](../../../instructions/rules/coding/config-visibility.md).

## How the profile is written

`.paqad/project-profile.yaml` is tracked, so every writer goes through
`writeProjectProfile` / `syncProjectProfile` in `src/core/project-profile.ts`, which edits the
file in place instead of re-serialising it:

- The existing file is parsed as a YAML document and only the keys whose value changed are
  replaced. Keys that are no longer part of the profile are removed and new keys are added at
  the end of their map. Untouched lines keep their formatting, comments and order.
- When the profile on disk already says the same thing, nothing is written: the bytes, the
  modified time and `.paqad/audit.log` stay as they were. A dashboard save that changes nothing
  and a second `checks run` therefore leave the file alone.
- A missing or unreadable file is written fresh, with long values (for example a `test_single`
  command over 80 characters) kept on one line, never folded.
- `syncProjectProfile` returns `{ path, written }`, so a caller can tell whether it changed the
  file. `writeProjectProfile` returns the path only.

`checks run` writes the profile for one reason: the one-time `testing` record, keyed to the
lockfile hash, made when the record is missing or the lockfile changed (and the sequential pin
after a parallel harness failure). When it does, it prints
`recorded the test runner in .paqad/project-profile.yaml (once per lockfile change)`.

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
