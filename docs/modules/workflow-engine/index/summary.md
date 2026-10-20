# Workflow Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `workflow-engine`

## Purpose

Loads YAML workflow definitions, validates them, and runs steps with
sequential, parallel, conditional, and resumable semantics. Handlebars
templates render step inputs.

## Source Footprint

- `src/workflows/engine.ts`
- `src/workflows/step-executor.ts`
- `src/workflows/parallel-executor.ts`
- `src/workflows/template-loader.ts`
- `src/workflows/template-validator.ts`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the code works the way it does

- **Cancellation (`engine.ts`, `step-executor.ts`, `parallel-executor.ts`).** An already-aborted
  signal returns at once, with no progress file and no started events. Between steps the run
  settles as cancelled and keeps the finished steps, records how many finished, and emits exactly
  one `run.cancelled` event, so the consumer can resume from the first unfinished step. A step
  never starts once the signal aborted; it throws so the engine and the parallel executor handle
  cancellation in one place, and the parallel executor returns as soon as the signal aborts even
  if a branch is slow. Progress is saved through a temp file and a rename, so a killed process
  never leaves a torn progress file.
- **`root-cause-analysis.ts`** keeps the user-facing `output_path` in posix form, since
  `path.join` gives backslashes on Windows.
- **`src/workflow-preflight/`.** Before a workflow does real work it checks everything the run
  needs and asks every open question in one interruption, instead of finding gaps late. The
  runner is generic and `registry.ts` is the only place that knows which workflow needs what
  (today only `site-map`); a workflow with no entry gets `ok: true` and no questions. A probe is
  read-only and must never boot the app, because whether to run project code is the question the
  person answers. A requirement with an `applies` gate that returns false is not declared at all.
  Probes run one after another so results keep declaration order and shell-outs do not pile up.

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
