# Deterministic Check Runner

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Slug:** `verification/check-runner` &nbsp;·&nbsp; **Issue:** #318, #554

## Purpose

The `checks` stage is the one the product thesis says must be **100% deterministic**:
run the project's format / test / build commands and block on red. It executes the mapped
commands and turns each into a `StructuredTestResult`, the exact shape the `code-tests-lint`
gate consumes. Since #554 it does this **fast without lowering the bar**: it runs the commands
as `&&` argv chains (never a shell), overlaps them, runs the test suite with the runner's own
parallel mode when the project has it, and confirms every parallel-run failure alone before it
blocks. No LLM, no heuristic — exit codes and parsed result files are the verdict.

## How it runs (per host)

The agent invokes `npx paqad-ai checks run` mid-turn, the same pattern as `paqad-ai stage`. On
**Claude Code** a red report also blocks the completion verdict; on **Codex/Gemini** the report is
recorded and read at completion; on advisory hosts the verb still runs but nothing blocks.

Before running, the agent runs `npx paqad-ai checks plan`; if it prints `test: sequential (unknown)`
it runs the **test-runner-discovery** skill and records the result with `npx paqad-ai checks
record-runner <file>`, so the next run is fast. paqad never asks the developer to add a flag or
install a package.

## Flow (#554)

1. **Execute correctly (Part A).** `parseCommandChain` / `runCommandChain`
   (`src/checks/command-chain.ts`) split a mapped command on the standalone `&&` token into
   quote-aware argv steps, run `mkdir -p` in-process, and reject every other shell metacharacter
   before spawning (INV-7). stdout is captured and the `test` command's output is parsed by the
   existing `parseTestOutput`, so a `mkdir && …` command can no longer read green without running a
   test (INV-4). The Laravel test command is always the Artisan wrapper.
2. **Plan (Part B).** Each stack pack test runner declares its `parallel` capability and a
   `single_test_selector`. Onboarding and `checks run` record the decision (`commands.test_parallel`
   + a `testing` block) from the pack entry and the ecosystem lockfile (`hasPackage`), mirrored in
   the stack doc. `resolveTestPlan` (`src/checks/parallel-plan.ts`, pure) maps that record + injected
   OS facts + the config knobs to `{ command, mode, processes, reason }`; the process count is
   `clamp(cores-1, 2, 16)`, capped for low memory and container wrappers.
3. **Schedule (Part C).** `runStages` (`src/checks/scheduler.ts`) runs formatters serially first,
   then overlaps the build + shell commands, then the test command alone. Every stage runs even
   after a red command; `passed` is computed at the end.
4. **Confirm failures alone (Part D).** `confirmFailures` (`src/checks/isolation-rerun.ts`) re-runs
   each failing test by itself. Fails alone → real, blocking, reported with test name / file / line.
   Passes alone → quarantined in the flaky registry and not blocking (under the `warn`/`pass` modes).
   The runner WRITES the registry, never READS it to change a verdict (INV-3). A mass failure
   (> 10 or > 5%) skips the re-runs and reports red.
5. **Fallback.** A parallel run that produced no parsed result (harness failure) re-runs the
   sequential command once and pins `testing.parallel: unavailable` until the lockfile changes.
6. **One report (Part E).** `checks.json` is `schema_version: 2`, **additive** — `passed`, `ran`,
   `results[]` keep their meaning, so every v1 reader keeps working (INV-6). New fields: `mode`,
   `commands[]`, `isolation_reruns`, `flaky_under_parallel`, `meaningful_green`, `critical_path`.
   The feature report page renders a Checks section from it.

## Inconclusive, never a false pass

When no command is mapped, or `checks run` was not run, there is no report:
`structured_test_results` stays undefined, the `code-tests-lint` gate stays `skipped`, and the
context escalates "test-evidence Inconclusive". The framework never reports green on unrun or
failing tests.

## Config

- `checks_parallel` (default on) — OFF restores the one-after-another run end to end.
- `checks_max_processes` (default 0 = auto) — cap on parallel test processes.
- `checks_flaky_under_parallel` (`pass|warn|fail`, default `warn`, floored) — what a pass-alone test
  does; `resolveChecksFlakyMode` (`src/checks/flaky-mode.ts`).

## Source Footprint

- `src/checks/run-checks.ts` — resolve + plan + schedule + parse + fallback + isolation.
- `src/checks/command-chain.ts` — the `&&` argv chain runner.
- `src/checks/parallel-plan.ts` — the pure test-plan resolver.
- `src/checks/scheduler.ts` — the concurrent command scheduler.
- `src/checks/isolation-rerun.ts` — the isolated re-run verdict + flaky quarantine.
- `src/checks/testing-record.ts` — derive + record the parallel decision + the stack-doc mirror.
- `src/checks/prerequisites.ts` — lockfile package lookup.
- `src/checks/test-runner.ts` — the one runner selector (shared with onboarding).
- `src/checks/flaky-mode.ts` — the floored `checks_flaky_under_parallel` resolver.
- `src/checks/record-runner.ts` — validate the agent-discovered runner record.
- `src/checks/constants.ts` — the shared tunables.
- `src/checks/report-store.ts` — v2 report persist / tolerant read.
- `src/checks/report-target.ts` — bundle-vs-global write/read dispatch (#528).
- `src/cli/commands/checks.ts` — the `run` / `plan` / `record-runner` verbs + the receipt.
- `runtime/base/skills/test-runner-discovery` — the agent discovery skill (Part B.5).
- `src/verification/repository/run-repository-verification.ts` — `checksEvidenceGate`.

## Authority

The single source of truth for this module's identity, slug, feature names, and source
paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml)
(feature slug `check-runner` under the `verification` module). If anything here
disagrees with the map, the **map wins**.
