# Stack Detection Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `stack-detection-engine`

## Purpose

Lockfile-first detection of frameworks, traits, and archetypes across
9 ecosystems. Drives onboarding, refresh, docs, MCP recommendations, and
security workflows from a single resolved stack profile.

## Source Footprint

- `src/detection`
- `src/core/stack-profile.ts`

## Features

- [Manifest & Lockfile Scanner](../features/manifest-scanner/business.md)
- [Archetype Resolution](../features/archetype-resolution/business.md)
- [Drift Tracking](../features/drift-tracking/business.md)

## Why the code works the way it does

- **`ai-detector.ts`.** The AI path is off unless an inference provider is injected, so by default
  detection stays static. It never throws: no provider, no manifests, a call or parse error, the
  timeout or a low score all return `null` and the static path runs, so static detection is always
  the last resort. The timeout rejects even if the provider ignores the abort signal. Each manifest
  is read directly and a failure caught, with no exists-check first, to avoid a check-then-read
  race; a missing file is skipped and the others still count.
- **`detector.ts`.** Two `detect()` calls on the same folder at once share one in-flight promise,
  so they return the same result without repeating the work. `persist: false` lets a read-only
  caller such as the onboarding dry-run detect without writing to `.paqad/`.
- **`types.ts`.** The response envelope is added at the engine edge so internal types stay lean.
  Its `id` is a SHA-256 of the project root and the report time, so two envelopes of one run share
  an id, and times are formatted in UTC so the output is the same on every machine.

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
