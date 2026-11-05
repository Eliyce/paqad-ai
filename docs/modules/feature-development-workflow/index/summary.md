# Feature Development Workflow

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `feature-development-workflow`

## Purpose

Generic feature-delivery pipeline assembled from YAML in
`docs/instructions/workflows/`. Routes through requirement analysis,
story design, parallel implementation + tests, adversarial review,
and verification. Conditional and parallel steps supported.

## How a stage's report is read

A stage agent reports through the `SubagentHandback` tool in `auto` permission mode and in plain
text everywhere else, because the tool exists only in `auto` mode. The ledger records whichever arrived. The rule for what a report means
sits in one function, `judgeStageReport` in `src/stage-isolation/stage-handback.ts`, called by
the handback hook, the stop check and the completion record. A `DONE` or `DONE_WITH_CONCERNS`
with no stage end row, or with no artifact on planning, specification, review or checks, is refused
at handback (exit 2) and sent back at SubagentStop (`decision: block`). Both paths share one count
per agent and stage: three refusals, then the report is let through as `BLOCKED` with the reason.
That count is paqad's own, because the host sets no ceiling on these retries.
Refusal rows use the `stage-handback` kind, so they release no running-agent hold. The main chat
reads the result with `paqad-ai stage report <agent_id>` and follows its `next_action` and
`resume_advice`. A crash in the check always lets the report through.

`advance` is true for a stated `DONE` or `DONE_WITH_CONCERNS` whose stage requirement is met, with green
checks and no breach. With no stated report, a met requirement reads as `DONE` and advances. If checks
are red or there is a must-not breach it reads as `DONE_WITH_CONCERNS` and holds. A status repaired by the
backfill is used in the same way. `next_action` then says one of these:

- continue to the next stage, carrying any concerns to the receipt
- present a decision, or resume the agent with its answer
- resume the agent with what it names, on `NEEDS_CONTEXT`
- wait for the agent, when its handback was sent back and it can retry, or wait for a running agent and
  resume it once if it has already returned
- on a no-Status hold from red checks, resume the development agent to fix the failures, then run checks
  again
- on a no-Status hold from a must-not breach, stop and tell the developer the reason
- resume once after a return with no report, and stop and tell the developer on a second silent return,
  held or not
- stop and tell the developer the reason, for anything else

## Stage start, recipes and turns

- **One way in.** `paqad-ai stage begin <stage>` records the start, loads the rules on development,
  writes the digest on review and prints the checks plan on checks, then prints one JSON object with
  the request, the previous pillars and the paths. A repeat run does not start twice. Its whole output
  stays at or under 27,000 characters, the measured Bash output limit less 10 percent, because the host
  replaces a longer output with a preview. Past that the longest file is cut first, with the line
  `truncated at 27,000 characters; read the file for the rest`. Instruction and command lines are not cut.
- **Refusal.** `stage start` and `stage begin` refuse a stage when an earlier stage's newest stated
  report is `BLOCKED`, `NEEDS_CONTEXT` or paused, naming the stage, the reason and the next action. A
  later end row with the artifact, or a newer `DONE`, clears it. Not refused: review and documentation
  sync side by side, a later stage's blocked report while development is resumed, a stage restarting
  itself, the fast and graduated lanes, inline runs, older bundles and unstated reports. No edit gate
  changes.
- **Recipes.** `runtime/base/skills/<stage>-recipe` holds each stage's method and script. The start
  hook sends the brief and the recipe, at most 9,700 characters together, and writes a
  `recipe-injected` row with the hash of the text sent, one row per agent and text, so reading the brief
  again adds none. Recipe text gives way first, at a line, with a
  pointer to its file. Each stage command runs the script from paqad's own install (`recipes.ts`,
  `recipe-check.ts`) and on a pass writes a `skill-used` row, which names an agent only when an agent id
  is on the command or on the stage's start row. The Ledger run line says `proven` only when the script
  really checked something, so a row with `unchecked` does not count. On a fail it refuses a stage an agent
  started after the update, and only notes it otherwise. A broken install warns and writes no row.
  `paqad-ai stage end documentation_sync --stale-ok <path>` names a doc that needs no change. Recipe
  text is a copy of its source skills, which stay for their other workflows. The stage agent files stay
  short and leave the method to the recipe. Paths a recipe names are relative to the install directory
  in `.paqad/framework-path.txt`. `.claude/agents` holds copies that a test keeps equal to the rendered
  agents.
- **A missing recipe.** An agent with no `## Your recipe` heading in its context runs `stage brief`, which
  prints the repair. If the recipe is still missing the agent carries on and reports that repair. It
  depends on the route, because `paqad-ai update` cannot restore a recipe. On the plugin, run
  `claude plugin update paqad@eliyce`; if that says it is already at the latest version, uninstall and
  install the plugin, then start a new session. On npm, run `npm i -g paqad-ai@latest`, then
  `paqad-ai update`. The completeness gate names the same repair and holds the change until the repair is
  done and the stage is run again, because the proof rows are missing.
- **When `stale-docs` lists a doc.** A module's doc is listed when a changed code file names the module
  or sits under one of its `sources` in `docs/instructions/rules/module-map.yml`. Tests, `docs/` and
  dot-folders do not count as code, so a run with nothing to sync passes.
- **Recipe script contract.** A script prints one JSON line, `{ ok, errors, hash }`, and exits 0 when
  `ok` is true and 1 when it found problems. At most 100 errors are printed, followed by `and <n> more`;
  the hash covers the full list. A missing input file or a bad command line exits 2 with the reason on
  stderr, and input that is not a JSON object exits 1 the same way. The stage commands read only that
  JSON line, so any run that does not print one counts as a broken install.
- **When `check-ac-map` passes.** Each automated criterion needs a test line this change added that names
  it. Test files are recognised across JavaScript, TypeScript, Python, Ruby, Java, Kotlin, Go, Rust, C#,
  PHP, Swift, Elixir, Dart, C and C++, among others. When the diff cannot be read it counts every test in
  the project (`scope: all-tests`) and says so. When no test can be read it passes, sets `unchecked` and
  prints a warning.
- **Proof.** On the full lane, the completeness gate asks each stage started after the update for a
  `stage-agent` completed row, a `recipe-injected` row and, when its recipe has a script, a `skill-used`
  row. Older stages get a note. On Codex the recipes are written to `.agents/skills/`, kept out of git
  by `.agents/skills/.gitignore`, and no `recipe-injected` row is written, because nothing was injected.
- **Turns.** Budgets are 50 percent above the measured baselines, rounded up to the next ten: planning
  100 (baseline 64), specification 60 (35), development 170 (109), review 70 (44), checks 20 (10) and
  documentation sync 30 (17). The completed row carries `api_turns`, and the receipt states turns per stage against the budget and the baseline.
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
in this page disagrees with the map, the **map wins**. To change this page:

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
