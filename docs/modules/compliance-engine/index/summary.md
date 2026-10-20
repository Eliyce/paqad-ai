# Spec Compliance Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `compliance-engine`

## Purpose

Parses structured Markdown specs into deterministic obligation
indexes, scans tests for explicit `@obligation` evidence, generates
failing Vitest skeletons, and validates index schema + duplicate IDs.

## Source Footprint

- `src/compliance`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the code works the way it does

The reasons below are not obvious from the code in `src/compliance/`.

- **Obligations and coverage (`obligation-extractor.ts`, `compliance-checker.ts`).** Generated
  obligation ids use a counter per section, so adding or removing a numbered item in one section
  never renumbers another. Coverage is strong when a test carries `@obligation <ID>` or names the
  id in an `it`/`test`/`describe` title, weak when the id only appears somewhere in a test file, and
  indeterminate for a generated id with no test signal. The ratio is covered over total minus
  indeterminate, since indeterminate obligations cannot be checked by a program, and it is guarded
  against a zero denominator. The cache key hashes the sorted test paths and their contents, so a
  rename and an edit both invalidate it. A cancel is checked before the scan and before the write,
  and a cancel during the scan leaves no report on disk.
- **Skeletons (`skeletons/vitest.ts`).** An existing test file is never overwritten, since the
  developer may have half-written it. Each stub names the obligation id, carries the `@obligation`
  annotation so the checker sees it, and always fails until it is written.
- **Boundary tests (`boundary/`).** A shared type is marked with a line comment right above it:
  `// @boundary <TypeName> [producer:<spec>] [consumer:<spec>,...] [states:<a>,<b>,...]`. With no
  explicit states, they are read from the enum (across lines) or single-line string union that
  follows. A state is unhandled for a consumer when its spec text never mentions it. Generated test
  stubs go to `.paqad/compliance/boundary-tests/<producer>__<consumer>__<TypeName>.test.ts`, are
  idempotent, and flag unhandled states. The gate is `skip` with no boundaries, `warn` with
  unhandled states, `pass` otherwise.
- **Defect patterns (`defect-patterns/`).** The store lives in `~/.paqad/defect-patterns/` (an
  `index.json` plus `entries/<id>.json`), next to the solution pattern library; a corrupt index is
  rebuilt from the entry files. Classification rules run in order and the first match wins, so
  format-variant rules sit above the generic variant rules; new rules need no core change, and an
  unmatched defect becomes `<category>.unclassified`. Recording runs after the gate has returned, so
  it adds no latency. Advisories and the agent-context block return nothing when no pattern meets
  the thresholds (so a first implementation sees no noise) and are capped at five. Each pattern keeps
  at most five examples. Old patterns are marked stale before they are removed.
- **Spec-review detectors.** Ids defined only in a heading (for example `### EC-5: Edge Case`) count
  as defined, so they are not reported as dangling. The formula detector skips URLs, file paths and
  trivially safe denominators, and reports a division only when another line says its denominator
  can reach zero. One contradiction per "always" subject is enough.

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
