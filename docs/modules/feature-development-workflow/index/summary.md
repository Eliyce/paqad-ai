# Feature Development Workflow

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `feature-development-workflow`

## Purpose

Generic feature-delivery pipeline assembled from YAML in
`docs/instructions/workflows/`. Routes through requirement analysis,
story design, parallel implementation + tests, adversarial review,
and verification. Conditional and parallel steps supported.

## How a stage's report is read

A stage agent reports through the `SubagentHandback` tool in `auto` permission mode and in plain
text everywhere else, and the ledger records whichever arrived. The rule for what a report means
sits in one function, `judgeStageReport` in `src/stage-isolation/stage-handback.ts`, called by
the handback hook, the stop check and the completion record. A `DONE` or `DONE_WITH_CONCERNS`
with no stage end row, or with no artifact on planning, specification, review or checks, is refused
at handback (exit 2) and sent back at SubagentStop (`decision: block`). Both paths share one count
per agent and stage: three refusals, then the report is let through as `BLOCKED` with the reason.
Refusal rows use the `stage-handback` kind, so they release no running-agent hold. The main chat
reads the result with `paqad-ai stage report <agent_id>` and follows its `next_action` and
`resume_advice`. A crash in the check always lets the report through.

## Source Footprint

- `src/pipeline/feature-development-policy.ts` (paqad's own stages) and the team files in `.paqad/configs/feature-development/`
- `src/workflows`
- `src/stage-evidence`
- `src/stage-isolation`

## Features

- [Lane & Complexity Routing](../features/routing/business.md)
- [Parallel Step Execution](../features/parallel-execution/business.md)
- [Conditional / Failure Handling](../features/conditional-steps/business.md)
- [Resumable Runs](../features/resumable-runs/business.md)
- [Feature Spec & "Done" Bar](../features/spec-and-done-bar/business.md)
- [Build in Small Pieces & Reconnect](../features/slicing-and-reconnect/business.md)

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
