# Module Health Ledger

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `module-health-ledger`

## Purpose

Per-module health, defect density, risk floor, and complexity scores
stored under `.paqad/module-health/`. Sync ingests pending provider
evidence; record writes normalized entries directly. Drives the
graph's intelligence overlays.

## Source Footprint

- `src/module-health`
- `.paqad/module-health`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the code works the way it does

The reasons below are not obvious from the code in `src/module-health/`.

- **`rollup.ts`.** No metric is ever invented or zeroed: one that cannot be computed is `null` and its
  reason goes in `blocked_metrics`. The rollup runs with whichever of the coverage and test reports
  it has. `contract_stability` stays blocked until a pack ships a public API extractor, and the
  mutation score stays blocked here because it comes from the verification-gate path. Files are
  matched to modules through the module map's `sources` globs, and that function is exported so
  the quality baseline reuses the same attribution. Without a pack `module_health` block the run is a
  `module_health_unknown` report. The audit record is appended only when profiles are written, so
  dry runs and tests do not grow the log; running the pack's test command is off by default.
- **Parsers (`parsers/`).** The set is closed and mirrors the enum in
  `src/validators/schemas/stack-pack.schema.json` (`lcov`, `cobertura`, `coverage-py-xml`,
  `gocover`, `junit-xml`, `go-json`, `jacoco`, `opencover`, `vitest-json`); adding one is a framework
  change, with no project-side loader. Paths are forward-slash and project-relative when the
  format allows. A test result that cannot be tied to a source file is kept with an empty `file`
  and lands in the unattributed bucket.
  - `cobertura` slices each `<class>` block and counts its `<line>` entries, so element order does
    not matter; `coverage-py-xml` is the same format and delegates to it.
  - `jacoco` and `opencover` read attributes by name because their order is not guaranteed; `jacoco`
    prepends the `<package>` path so paths match `src/main/java/...` globs.
  - `gocover` counts statements as lines (the closest Go has) and treats a block as fully covered
    or fully uncovered; `go-json` keys tests by package, since Go reports packages, not files.
  - `lcov` reads only `LF` and `LH`; branch and function figures are ignored because health rolls up
    to one coverage figure per file. `vitest-json` ignores its optional `coverage` field, since
    coverage arrives through the lcov reporter. `junit-xml` maps the `file` attribute when a runner
    writes one.

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
