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

The agent invokes `npx paqad-ai checks run` mid-turn, the same pattern as `paqad-ai stage`
(`--no-reuse` forces every command to run for real). On
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
   after a red command; `passed` is computed at the end. The stage-1 commands (format, lint)
   always run for real and always run first, in sequential mode too, because they can rewrite
   files and the tree identity is taken after them.
4. **Format only the changed files when it is provably the same formatter.** A stack pack can
   declare `format_changed` entries (`{ default_command, script, command }`, the command holding
   `{files}` once as its own argument). `resolveFormatCommand` (`src/checks/format-changed.ts`)
   swaps the entry's command in for the format command only when the resolved profile command
   equals `default_command` exactly, `package.json` `scripts.format` equals `script` exactly,
   git lists the files (`diff --name-only --relative -z HEAD` plus
   `ls-files --others --exclude-standard -z`), and 1 to 200 files remain. The list also takes in
   the change's own changed files (the same list the report's evidence scope uses), so files
   already committed on the branch are formatted too. A path is kept only
   when it stays inside the root (no absolute path, no `..`), exists now as a regular file, and is
   not a symlink that resolves outside the root; deleted and ignored files drop out. Each kept
   path gets a `./` prefix, so a name starting with a dash is never read as an option, and the
   scheduler replaces the `{files}` argument with one argv element per path after the command is
   split, so a name with spaces stays one argument and is never re-parsed. Every other case runs
   the full format command. The react and node-service packs declare `pnpm format` and
   `npm run format` (script `prettier --write .`).
5. **Take the tree identity.** `computeTreeIdentity` (`src/checks/tree-identity.ts`) names the
   exact content of the working tree: tracked and untracked files that are not git-ignored, minus
   the four paqad record folders `.paqad/ledger`, `.paqad/checks`, `.paqad/traceability` and
   `.paqad/decisions` (`TREE_IDENTITY_EXCLUDED_DIRS`, the one list `checks run` and the completion
   gate share). The rest of `.paqad` is in the identity, because tests read files such as
   `.paqad/scripts`. It returns `{ digest, head_commit, computed_at }`, or null outside git, in a
   repository with no commits, without a git binary, or past its time limit (60 s for
   `checks run`). It is also null when the index holds an entry whose edits git cannot see: a
   submodule or nested repository (a gitlink names only the nested repository's commit, not its
   uncommitted edits), or a file marked `assume-unchanged` or `skip-worktree`. The reason names
   the path. `head_commit` is null on an unborn branch of a repository that has commits.
6. **Reuse a green run on an identical tree.** For every non-stage-1 command (build, test and any
   other), `checks run` looks at the newest row in the run history for that exact command string
   (for test, the resolved test command with any parallel flags), whatever its tree or outcome.
   The command is reusable only when that row passed and is reusable, its report snapshot exists,
   parses and hashes to the recorded sha256, and the snapshot shows the same tree digest, the same
   command, the same lockfile hash (`lockfileHash`; null matches only null), the same Node version,
   a passed real outcome and, for test, a structured result with counts. A build also needs the
   pack's `build_outputs` folders (react and node-service declare `dist`): every folder must exist
   and the fingerprint of their files (sorted relative path, size and mtime, hashed) must equal the
   one recorded after the real green build. If any wanted command fails this, every non-stage-1
   command runs for real: a report never mixes reused and real ones. A reused command is reported
   with `passed: true`, `exit_code: 0`, `duration_ms: 0`, `outcome: "reused"`, `reused_from` (the
   real run's start time) and `tree_digest`; a reused test carries the original structured result
   with its evidence scope set to the current changed files, so the gate and the receipt show the
   real totals. The receipt prints one line per reused command:
   `> - 🟢 reused green <name> run from HH:MM (same files, same command)`, with `: N tests` after it
   for test when the count is readable.
7. **Record the real run.** Each real run writes a snapshot of its own report to
   `.paqad/checks/runs/<run_id>.json` and then appends one row per non-stage-1 command to
   `.paqad/checks/run-history.jsonl` (`run_id`, `logical_command`, `command`, `tree_digest`,
   `ran_at`, `passed`, `reusable`, `report_path`, `report_sha256`). Rows are appended only after the
   whole run finished, under a file lock with an atomic rewrite, so a run stopped halfway records
   nothing and two runs never read each other's unfinished rows. The file keeps the newest 50 rows;
   a snapshot no kept row points at is deleted. An empty, truncated or corrupt line is skipped. A
   row is reusable only when the command passed and the identity taken again right after the run
   equals the one taken before it; a test row also needs no harness fallback, no isolation re-run,
   no recovered test, a readable result and `meaningful_green`. `--no-reuse` runs every command
   for real and still records the rows, so a later plain run can reuse them. Without a tree
   identity nothing is recorded and every command runs for real.
8. **Confirm failures alone (Part D).** `confirmFailures` (`src/checks/isolation-rerun.ts`) re-runs
   each failing test by itself. Fails alone → real, blocking, reported with test name / file / line.
   Passes alone → quarantined in the flaky registry and not blocking (under the `warn`/`pass` modes).
   The runner WRITES the registry, never READS it to change a verdict (INV-3). A mass failure
   (> 10 or > 5%) skips the re-runs and reports red.
9. **Fallback.** A parallel run that produced no parsed result (harness failure) re-runs the
   sequential command once and pins `testing.parallel: unavailable` until the lockfile changes.
   The `testing` record is the only thing `checks run` writes to the profile. The write is in
   place and skipped when nothing changed, so a second run leaves the file byte-identical; when
   it does record, the run prints
   `recorded the test runner in .paqad/project-profile.yaml (once per lockfile change)`.
10. **One report (Part E).** `checks.json` is `schema_version: 3`, **additive** — `passed`, `ran`,
   `results[]` keep their meaning, so every v1 and v2 reader keeps working (INV-6). Fields: `mode`,
   `commands[]`, `isolation_reruns`, `flaky_under_parallel`, `meaningful_green`, `critical_path`,
   and since schema 3 the optional `tree` (the identity taken after the format stage and before
   any other command ran, on a reused run and on a real one alike), `tree_unavailable_reason` (why
   there is no `tree`), `tree_after_run` (`moved` when the identity taken again after a real run
   differs from `tree`, `unconfirmed` when it could not be taken), `run_id`,
   `lockfile_hash` and `node_version`; each command may carry `outcome: "reused"`, `reused_from`,
   `tree_digest` and `build_output_fingerprint`. Every reader of a command `outcome` compares it to
   `"inconclusive"` explicitly, so a reused command never reads as inconclusive. The feature report
   page renders a Checks section from it.
11. **Count what ran.** The TAP parser counts leaf tests only, at any indent: vitest's
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
`checks ran, but no test results could be read: Inconclusive` header, stores
`outcome: "inconclusive"` on that test command in `checks.json`, and sets
`meaningful_green: false`. It does not block (the exit code stays 0), and it never reads green.

Every parsed test result carries the time the command ran as its summary `timestamp`. A parser
that could not read a time no longer leaves the epoch (`1970-01-01T00:00:00.000Z`) behind.

A logical command mapped to an empty string in the profile (onboarding leaves one empty when
`package.json` has no such script) is not mapped: `checks run` skips it with
`<name> is not mapped in the profile; skipped` and runs the rest.

A report that names a tree is checked against the current tree at the completion gate (10 s
limit, same helper and exclusions). On a different tree `code-tests-lint` reads Inconclusive with
`Checks ran on different files than the ones in this change now. Run paqad-ai checks run again.`;
when the current tree cannot be computed or the limit runs out it reads Inconclusive with
`Checks could not confirm which files they ran on. Run paqad-ai checks run again.`. Either way the
checks do not count as verified for the stage receipt. A report whose `tree_after_run` is `moved`
reads as ran on different files and one whose `tree_after_run` is `unconfirmed` as unconfirmed,
whatever the current tree is: the files changed while the commands ran, so no single tree was
tested. A report without a tree (schema 2, or
written where no identity was possible) keeps today's verdict.

When no command is mapped, or `checks run` was not run, there is no report:
`structured_test_results` stays undefined, the `code-tests-lint` gate stays `skipped`, and the
context escalates "test-evidence Inconclusive". The framework never reports green on unrun or
failing tests.

## Config

- `checks_parallel` (default on) — OFF restores the one-after-another run end to end.
- `checks_max_processes` (default 0 = auto) — cap on parallel test processes.
- `checks_flaky_under_parallel` (`pass|warn|fail`, default `warn`, floored) — what a pass-alone test
  does; `resolveChecksFlakyMode` (`src/checks/flaky-mode.ts`).
- Green-run reuse has no config key. `paqad-ai checks run --no-reuse` is the only override; deleting
  `.paqad/checks/run-history.jsonl` also resets it. The history and snapshots are local and
  git-ignored, so reuse never crosses machines, and CI, which starts from a fresh checkout, always
  runs for real.

## Why the code works the way it does

The reasons below are not obvious from the code in `src/checks/` and are not stated above.

- **`command-chain.ts`.** The old runner split a command on whitespace and spawned the first token,
  so `mkdir -p dir && ./vendor/bin/pest …` ran `mkdir` with the rest as directory names and read
  green without running a test; the argv chain exists to make that impossible. `&` alone is not in
  the rejected set because `&&` is the operator. The tokenizer only understands quotes (no escaping,
  variables or globs); quote marks are dropped and the inner whitespace kept. A blank command parses
  to no steps and is skipped. The first non-zero exit stops the chain and becomes its exit code.
- **`build-output.ts`.** The tree identity leaves out git-ignored files, and `dist` is one, while
  tests in a project like this one spawn the built CLI. Reusing a build is only safe when its output
  is still the output the green build left, so the fingerprint reads the files' size and mtime
  (not their content, which would cost as much as hashing the build) right after the real run and
  again before a reuse. A pack that names no build output, or a missing folder, makes build and
  test run for real.
- **`constants.ts`.** The plan resolver, scheduler, re-run verdict and report share one set of
  numbers, because a second copy would silently move the quality bar.
- **`flaky-mode.ts`.** Floored like every enforced mode: the tracked value is the floor and local
  config or `PAQAD_CHECKS_FLAKY_UNDER_PARALLEL` may only raise it (`pass` < `warn` < `fail`).
- **`format-changed.ts`.** Formatting only the changed files is a different command from the
  project's format script, so it is used only when the pack proves it is the same formatter: the
  profile command and the `package.json` script must both match the pack entry byte for byte. Paths
  come from git and are passed as argv elements, never through a shell or the command parser, which
  is why the `./` prefix and the inside-the-root check are enough to stop option and path
  injection. Above 200 files the full command is as fast and cannot hit an argv length limit.
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
- **`run-history.ts`.** Strict reuse takes the newest row for a command whatever its tree, so a
  failed run followed by a fix never reuses an older green row: the recheck always runs. A row is
  trusted only when its snapshot hashes to the recorded sha256 and agrees with it; the edit hook
  refuses an Edit or Write into `.paqad/checks`, so forging a green run takes a deliberate shell
  write of both files, and CI stays the backstop. Rows are appended at the very end of a run so an
  interrupted run leaves nothing that a retry could reuse.
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
- **`tree-identity.ts`.** The identity is git's own tree id, built on a copy of the real index so
  git keeps its stat cache (an empty index would hash every file). The copy keeps the real index's
  timestamp, so git's racy-entry check treats a same-second, same-size edit exactly as it does for
  the real index; a fresh timestamp would let such an edit look clean. `GIT_INDEX_FILE` is set only
  on the git child process, the copy lives in a unique `mkdtemp` folder removed in a `finally`, and
  the real index and its lock are never written. `git rev-parse --git-path index` finds the index
  in a linked worktree too. The record folders are dropped with `git rm --cached` after
  `git add -A`, because an exclude pathspec on a git-ignored folder makes `git add` fail. A side
  effect: `git add -A` writes loose objects into `.git/objects` for untracked, non-ignored files
  (including a stray un-ignored secret such as a `.env`) until `git gc` removes them; nothing is
  committed or pushed.
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
- `src/checks/scheduler.ts` — the concurrent command scheduler and the `{files}` argv substitution.
- `src/checks/tree-identity.ts` — the whole-tree identity and the shared excluded folders.
- `src/checks/run-history.ts` — the run history, report snapshots and the strict reuse lookup.
- `src/checks/build-output.ts` — the pack build output folders and their fingerprint.
- `src/checks/format-changed.ts` — the guarded changed-files format command.
- `src/checks/isolation-rerun.ts` — the isolated re-run verdict + flaky quarantine.
- `src/checks/testing-record.ts` — derive + record the parallel decision + the stack-doc mirror.
- `src/checks/prerequisites.ts` — lockfile package lookup.
- `src/checks/test-runner.ts` — the one runner selector (shared with onboarding).
- `src/checks/flaky-mode.ts` — the floored `checks_flaky_under_parallel` resolver.
- `src/checks/record-runner.ts` — validate the agent-discovered runner record.
- `src/checks/constants.ts` — the shared tunables.
- `src/checks/report-store.ts` — schema 3 report persist / tolerant read.
- `src/checks/report-target.ts` — bundle-vs-global write/read dispatch.
- `src/cli/commands/checks.ts` — the `run` / `plan` / `record-runner` verbs + the receipt.
- `runtime/base/skills/test-runner-discovery` — the agent discovery skill (Part B.5).
- `src/verification/repository/run-repository-verification.ts` — `checksEvidenceGate`.
- `src/verification/repository/repository-context.ts` — `checksReportStaleness`, the gate's tree check.
- `src/kernel/capability.ts` — refuses hand edits into `.paqad/checks`.

## Authority

The single source of truth for this module's identity, slug, feature names, and source
paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml)
(feature slug `check-runner` under the `verification` module). If anything here
disagrees with the map, the **map wins**.
