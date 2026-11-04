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

## Stage start, recipes and turns

- **One way in.** `paqad-ai stage begin <stage>` records the start, loads the rules on development,
  writes the digest on review and prints the checks plan on checks, then prints one JSON object with
  the request, the previous pillars and the paths. A repeat run does not start twice. Its whole output
  stays at or under 27,000 characters, because the host replaces a longer Bash output with a preview.
- **Refusal.** `stage start` and `stage begin` refuse a stage when an earlier stage's newest stated
  report is `BLOCKED`, `NEEDS_CONTEXT` or paused, naming the stage, the reason and the next action. A
  later end row with the artifact, or a newer `DONE`, clears it. Not refused: review and documentation
  sync side by side, a later stage's blocked report while development is resumed, a stage restarting
  itself, the fast and graduated lanes, inline runs, older bundles and unstated reports. No edit gate
  changes.
- **Recipes.** `runtime/base/skills/<stage>-recipe` holds each stage's method and script. The start
  hook sends the brief and the recipe, at most 9,700 characters together, and writes a
  `recipe-injected` row with the hash of the text sent. Recipe text gives way first, at a line, with a
  pointer to its file. Each stage command runs the script from paqad's own install (`recipes.ts`,
  `recipe-check.ts`) and on a pass writes a `skill-used` row. On a fail it refuses a stage an agent
  started after the update, and only notes it otherwise. A broken install warns and writes no row.
  `paqad-ai stage end documentation_sync --stale-ok <path>` names a doc that needs no change. Recipe
  text is a copy of its source skills, which stay for their other workflows.
- **Proof.** On the full lane, the completeness gate asks each stage started after the update for a
  `stage-agent` completed row, a `recipe-injected` row and, when its recipe has a script, a `skill-used`
  row. Older stages get a note. On Codex the recipes are written to `.agents/skills/`, kept out of git
  by `.agents/skills/.gitignore`, and no `recipe-injected` row is written, because nothing was injected.
- **Turns.** Budgets are 50 percent above the measured baselines. The completed row carries `api_turns`,
  and the receipt states turns per stage against the budget and the baseline.
  `scripts/stage-benchmark.mjs` measures a sample of runs, and `scripts/skill-consumer-scan.mjs` lists
  each base skill with its consumers.


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
