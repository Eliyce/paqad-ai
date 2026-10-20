# Deterministic Check Runner

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Slug:** `verification/check-runner`

## Purpose

The `checks` stage is the one the product thesis says must be **100% deterministic**:
run the project's format / test / build commands and block on red. It executes the mapped
commands and turns each into a `StructuredTestResult`, the exact shape the `code-tests-lint`
gate consumes. It does this **fast without lowering the bar**: it runs the commands
as `&&` argv chains (never a shell), overlaps them, runs the test suite with the runner's own
parallel mode when the project has it, and confirms every parallel-run failure alone before it
blocks. No LLM, no heuristic — exit codes and parsed result files are the verdict.

## How it runs (per host)

The agent invokes `npx paqad-ai checks run` mid-turn, the same pattern as `paqad-ai stage`. On
**Claude Code** a red report also blocks the completion verdict; on **Codex/Gemini** the report is
recorded and read at completion; on advisory hosts the verb still runs but nothing blocks.

The report goes into the bundle of the session the verb runs under (`src/checks/report-target.ts`),
resolved in the same order as every other verb: the first non-blank of `SE_SESSION`, then
`CLAUDE_SESSION_ID`, then the cached session id. A stage agent running `checks run` with the
orchestrator's `SE_SESSION` therefore reports into the orchestrator's change, not its own.

Before running, the agent runs `npx paqad-ai checks plan`; if it prints `test: sequential (unknown)`
it runs the **test-runner-discovery** skill and records the result with `npx paqad-ai checks
record-runner <file>`, so the next run is fast. paqad never asks the developer to add a flag or
install a package.

## Flow

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
   The `testing` record is the only thing `checks run` writes to the profile. The write is in
   place and skipped when nothing changed, so a second run leaves the file byte-identical; when
   it does record, the run prints
   `recorded the test runner in .paqad/project-profile.yaml (once per lockfile change)`.
6. **One report (Part E).** `checks.json` is `schema_version: 2`, **additive** — `passed`, `ran`,
   `results[]` keep their meaning, so every v1 reader keeps working (INV-6). New fields: `mode`,
   `commands[]`, `isolation_reruns`, `flaky_under_parallel`, `meaningful_green`, `critical_path`.
   The feature report page renders a Checks section from it.
7. **Count what ran.** The TAP parser counts leaf tests only, at any indent: vitest's
   per-file and per-suite entries (lines ending in `{`) and node:test parent entries (printed after
   their subtests) are containers, so an indented `not ok` is a failure and an indented `# SKIP` a
   skip. A pass read only from the exit code (no structured runner, plain-text fallback) has no
   count, so the receipt says `test passed, count unavailable`, never `0 tests` or `1 tests`. Onboarding writes a pnpm test command
   without a `--` separator (`pnpm test --reporter=tap`): pnpm passes a literal `--` on to the
   script, and vitest then ignores the reporter flag and the test pattern after it.

## Inconclusive, never a false pass

A test command that exits 0 while its runner's parser reads no tests at all (empty or
unrecognised output, for example a Sail wrapper printing `Docker is not running.`) proved
nothing. `checks run` shows it as
`> - 🟡 test ran, but no test results could be read (<secs>)` under a
`checks ran, but no test results could be read — Inconclusive` header, stores
`outcome: "inconclusive"` on that test command in `checks.json`, and sets
`meaningful_green: false`. It does not block (the exit code stays 0), and it never reads green.

Every parsed test result carries the time the command ran as its summary `timestamp`. A parser
that could not read a time no longer leaves the epoch (`1970-01-01T00:00:00.000Z`) behind.

A logical command mapped to an empty string in the profile (onboarding leaves one empty when
`package.json` has no such script) is not mapped: `checks run` skips it with
`<name> is not mapped in the profile; skipped` and runs the rest.

When no command is mapped, or `checks run` was not run, there is no report:
`structured_test_results` stays undefined, the `code-tests-lint` gate stays `skipped`, and the
context escalates "test-evidence Inconclusive". The framework never reports green on unrun or
failing tests.

## Config

- `checks_parallel` (default on) — OFF restores the one-after-another run end to end.
- `checks_max_processes` (default 0 = auto) — cap on parallel test processes.
- `checks_flaky_under_parallel` (`pass|warn|fail`, default `warn`, floored) — what a pass-alone test
  does; `resolveChecksFlakyMode` (`src/checks/flaky-mode.ts`).

## Why the code works the way it does

The reasons below are not obvious from the code in `src/checks/` and are not stated above.

- **`command-chain.ts`.** The old runner split a command on whitespace and spawned the first token,
  so `mkdir -p dir && ./vendor/bin/pest …` ran `mkdir` with the rest as directory names and read
  green without running a test; the argv chain exists to make that impossible. `&` alone is not in
  the rejected set because `&&` is the operator. The tokenizer only understands quotes (no escaping,
  variables or globs); quote marks are dropped and the inner whitespace kept. A blank command parses
  to no steps and is skipped. The first non-zero exit stops the chain and becomes its exit code.
- **`constants.ts`.** The plan resolver, scheduler, re-run verdict and report share one set of
  numbers, because a second copy would silently move the quality bar.
- **`flaky-mode.ts`.** Floored like every enforced mode: the tracked value is the floor and local
  config or `PAQAD_CHECKS_FLAKY_UNDER_PARALLEL` may only raise it (`pass` < `warn` < `fail`).
- **`isolation-rerun.ts`.** Each re-run writes to its own redirected result file, so it never
  overwrites or reads the crowd run's file. The selector is the last `::` segment of a pytest node
  id, else the whole id. Set-aside tests are removed from a copy of the result and the summary is
  decremented; under `fail` they stay blocking.
- **`parallel-plan.ts`.** OS facts are injected so the resolver is pure and a unit test never
  depends on the host. A record that says `available` but has no command degrades to sequential
  rather than guessing one.
- **`prerequisites.ts`.** It reads lockfiles and never runs a package manager. No lockfile for the
  ecosystem returns unknown instead of a false "no". Names compare case-insensitively with `-` and
  `_` treated alike, except `composer.lock`, which matches exactly.
- **`record-runner.ts`.** The verb never trusts the discovery JSON. The parallel command must start
  with the project's own runner invocation and add only allowlisted parallel flags, with
  `<processes>` exactly once. Only unknown tokens are checked for shell metacharacters, so
  `--jobs=<processes>` is never a false hit; `&&` and `--` are structural.
- **`report-store.ts` and `report-target.ts`.** `checks run` is invoked mid-turn while the backstop is
  a separate Stop-hook process, so the report on disk is how the backstop proves the checks ran
  instead of assuming they passed. Writes are atomic. A corrupt or partial report reads as no report
  (Inconclusive), never a throw or a false pass. In the bundle copy the envelope header's
  `recorded_at` replaces `generated_at`; the global fallback file keeps the plain shape. One module
  decides bundle versus global for the writer and both readers. Unlike `resolveActiveFeature`, the
  lookup never mints a bundle, so a chat turn falls back to the global path, and an empty bundle read
  also falls back so a report written before the bundle opened is not lost.
- **`test-runner.ts`.** Onboarding and the runner share this one selector. A runner with no
  structured format is skipped, since an unparseable runner counts as no runner.
- **`testing-record.ts`.** The same path derives the record at onboarding and at `checks run`, and
  writes the stack-doc mirror with it so the two always move together (`checks plan` passes a flag to
  stay read-only). A lockfile hash means the decision is re-derived only after a lockfile changes.
  The parallel flag is inserted right after the runner invocation and before the structured-output
  flags so their order is kept. A project without `docs/instructions/stack/` gets no mirror.

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
- `src/checks/report-target.ts` — bundle-vs-global write/read dispatch.
- `src/cli/commands/checks.ts` — the `run` / `plan` / `record-runner` verbs + the receipt.
- `runtime/base/skills/test-runner-discovery` — the agent discovery skill (Part B.5).
- `src/verification/repository/run-repository-verification.ts` — `checksEvidenceGate`.

## Authority

The single source of truth for this module's identity, slug, feature names, and source
paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml)
(feature slug `check-runner` under the `verification` module). If anything here
disagrees with the map, the **map wins**.
