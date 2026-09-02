# Site Map Rebuild: implementation plan

**Status:** ready to implement. Nothing in this plan has been built yet.
**Written:** 2026-08-31, against paqad-ai 1.78.1 on `main`.
**Owner:** Haider Lasani.

This is the single source of truth for the site-map rebuild. If this file and any other
document disagree, this file wins. If this file and the code disagree, stop and say so
rather than guessing.

---

## 0. How to use this document

Three files live in `docs/development/site-map/`:

| File | What it is | Who writes it |
| --- | --- | --- |
| `plan.md` | The full plan. Read-only during implementation. | Only a human, or an agent that has been told to revise the plan. |
| `progress.md` | What is done, what is next. | Every session, after every commit. |
| `prompt.md` | The prompt to paste into a fresh session. | Only a human. |

**Every session does this, in order:**

1. Read `progress.md` first. It says which task is next and what state the branch is in.
2. Read this file's section for that task, and only that task.
3. Do the task. Commit it.
4. Update `progress.md`: tick the task, add the commit hash, write the next action.

Do not read the whole plan and try to do several tasks at once. One task, one commit,
one progress update.

---

## 1. Rules of engagement

These are not suggestions. Breaking one means the work has to be redone.

**Branch and PR**

- ONE branch for the whole rebuild: `feat/site-map-rebuild`, created from `origin/main`.
- ONE pull request, opened against `main`, kept open until every task is done.
- Create the branch from a freshly fetched `origin/main`, never from a stale local `main`.
- Never force-push. Never rebase after the PR is opened. Add commits.

**Commits**

- Small. One task (or one sub-task, `S3a`, `S3b`) per commit.
- Every commit must leave the repository green: `pnpm run ci` passes.
- Commit message format is given per task below. Use it verbatim, including the task id.
- Do not squash locally. The PR is squash-merged at the end by a human.

**Scope discipline**

- Do not refactor code the task does not name. If you find a real problem outside the
  task, write it in `progress.md` under "Found on the way", and keep going.
- Do not change public API shapes, config defaults, or exit codes unless a task says to.
- Do not add a dependency. If a task seems to need one, stop and ask.
- Do not touch `docs/site-map/app-map.yaml` (this repo's own live map) by hand. Tasks that
  change it do so through code, and `S8` is the only task that writes it.

**Honesty**

- If a task cannot be completed as written, do the rest of it, and write exactly what you
  could not do and why in `progress.md`. Do not silently narrow the task.
- Do not write a test that asserts what the code does. Write the test the acceptance
  criterion describes, then make the code satisfy it.
- Never fabricate evidence, a passing run, or a coverage number.

---

## 2. Ground truth: the defects being fixed

All of this was verified by reading the repository on 2026-08-31. Do not re-research it.
The line numbers were correct at commit `35fdf431`; if a line has moved, find the symbol.

| id | Defect | Proof |
| --- | --- | --- |
| **D1** | The agent reads a stale rulebook. `.paqad/compiled-rules.json` was compiled 2026-07-29 and never rebuilt. `session-context.md` is recomposed every turn from that stale store, so it serves a month-old site-map procedure that names the wrong map folder (`docs/instructions/site-map/`) and claims "the verb compiles the layers into `app-map.yaml`", which is false. | Live rule hash `a0b3611…` vs stored `752c94c…`. 45 rule files on disk, 44 compiled. `isCompiledRulesStale()` exists in `src/planning/rule-compiler.ts:83` but is only called by `src/onboarding/orchestrator.ts:362` and `src/cli/commands/join.ts:144`. |
| **D2** | Nothing writes the map. The CLI has `run`, `questions`, `answer`, `journey confirm/reject`. There is no create. The AI hand-types the whole YAML. | `src/cli/commands/sitemap.ts`. Also `src/cli/program.ts:65` registers `sitemap` as `{ hidden: true }`, so a human cannot discover or drive it. |
| **D3** | Nothing detects links. Zero code produces a transition; every link is hand-typed. | The string `transition` does not appear in `src/site-map/extraction.ts`, `gatherer.ts`, or `assemble.ts`. This repo's own map: 112 surfaces, 0 transitions, 3 journeys. |
| **D4** | An absent or link-less map reads "Safe to merge". `collectVerificationFindings` returns no findings **and no blocked checks** when the map is null. All reachability checks are gated on at least one transition already existing, and the skip is not recorded. | `src/site-map/verification.ts:493` (`if (map === null) return { candidates: [], blockedChecks: [] }`) and `:394` (`const hasGraph = map.surfaces.some(...)`). |
| **D5** | A command that cannot run asks nothing. `php artisan route:list` gets 20s, then silently degrades to a text scan and files a note nobody reads. The dashboard surfaces only a count. | `src/site-map/gatherer.ts:309` (`ARTISAN_TIMEOUT_MS = 20_000`), `:394-430` (silent fallback), `src/dashboard/ops-jobs.ts:231` (returns `blocked_checks.length` only). |
| **D6** | The question tray fires last and can ask four things. Questions are derived from gaps in an already-written map, so a fully authored map asks nothing. | Candidate builders at `src/site-map/creation-answers.ts:204,219,234,252`. Categories at `src/core/types/site-map-answers.ts:25`. `docs/site-map/answers.yaml` holds 1 answer from the last real run. |
| **D7** | Every session starts from zero. Nothing records how far a run got. The only stateful file is one global last-write-wins pointer holding a workflow name and a prompt, with no progress. | `.paqad/context/.session-route.json` currently reads `{"workflow":"rules-generate", …}` from a session weeks ago. `docs/instructions/rules/coding/site-map.md` mentions progress or resume zero times. A progress store existed (`ca8aefa0`) and was removed in `6d6f2178` along with the published output files it tracked; it never tracked authoring. |
| **D8** | The dashboard has no full screen anywhere, and shows no run progress. Three bands (title + why-sentence, honesty strip, journey picker) plus a 216px sidebar sit above the canvas; only the sidebar collapses. The zoom floor allows 5%. The progress plumbing exists and is not connected to this area. | No `requestFullscreen` anywhere in `graph-ui/src`. Bands at `graph-ui/src/views/SiteMapView.tsx:131,162,~209`; sidebar at `graph-ui/src/components/DashboardChrome.tsx:161`. `minZoom={0.05}` at `graph-ui/src/components/SiteMapCanvas.tsx:313`. `graph-ui/src/components/OpButton.tsx` already starts a job, subscribes to the `ops-progress` SSE stream, shows the latest message and polls as a backstop; it is used by `ModuleMapView`, `SetupView` and `KnowledgeRagPanel`, but not by `SiteMapView`, even though `src/dashboard/ops-jobs.ts:221` already calls `progress(...)`. |

---

## 3. Task order and dependencies

Do them in this order. The number is the order; the arrow is a hard dependency.

```
S1  Recompile the stale rulebook                    (no dependency)
S2  Honest verdict                                  (no dependency)
S3  Preflight + one tray                            (BLOCKED on decision DEC-1, see §5)
S4  Surface inventory                               (no dependency)
S5  Progress store with crash recovery              <- S4
S6  Show progress in the dashboard                  <- S5
S7  Full screen + readable zoom floor               (no dependency)
S8  A command that drafts the map                   <- S4, S5
S9  Find the links in the code                      <- S8
S10 Rewrite the workflow rule                       <- S3, S5, S8, S9
```

`S1` and `S2` first because they stop the tooling from reporting success it has not earned.
Everything after that is easier to trust once they are in.

`S10` is last because it documents the flow the other tasks build. Writing it earlier means
writing it twice.

---

## 4. Repository conventions you must obey

Read this section once, at the start of the first session. It is where mistakes happen.

**Verify before you push**

- `pnpm run ci` is the full gate: `typecheck`, `lint`, `format:check`, `test:coverage`,
  `graph-ui:test`, `build`. Run it before every push, not just at the end.
- **Never run two test suites at the same time.** Concurrent runs produce fake failures with
  nonsense timings (a 10s limit reported as "taking 1029672ms"). If you see that, you have
  two runs going. Kill both and run one.
- CI runs on Windows and macOS. Platform bugs surface there, not locally.

**Coverage**

- Repo floor: 95% branches, functions, lines, statements (`vitest.config.ts:161`).
- `src/stage-evidence/**` holds a 100% floor (`vitest.config.ts:169`).
- Every new branch needs a test. An unreachable branch added "for safety" will break the
  floor and cannot be covered: do not add one.

**Cross-platform**

- Posix paths everywhere in stored data and comparisons. Use `toPosixPath` from
  `src/core/path-utils.ts`.
- `:` is illegal in a Windows filename. Never put one in a generated path.
- `.mjs` hook files need the executable bit set.

**Release**

- This PR is releasable, so it needs a changeset. Run `npx changeset` once (a `minor` bump,
  summarising the whole rebuild), commit the generated `.changeset/*.md`, and validate with
  `npx changeset status`.
- Add the changeset early, not at the end, so the PR is never in a non-releasable state.

**Reuse before building**

- Before adding an exported function, run `npx paqad-ai index query <name>` and read the
  "Existing surface" section of the session context. Several tasks below name the existing
  thing to copy or reuse; use it.

**The framework will gate your own edits**

The implementing session routes to feature-development, so paqad blocks edits until the
planning and specification stages are recorded with real artifacts:

```
export SE_SESSION=$CLAUDE_SESSION_ID        # every stage/plan/spec/review call needs this
npx paqad-ai stage start planning
npx paqad-ai plan compile <plan-template.json>     # template MUST carry a "reuse" section
npx paqad-ai stage end planning --artifact <plan.json>
npx paqad-ai stage start specification
npx paqad-ai spec freeze <spec.md> --confirm-invariants
npx paqad-ai stage end specification --artifact <specification.json>
```

- `spec freeze` categorises by **section heading**, not line prefix. Use
  `## Functional requirements` with `- INV-1:` entries (the colon matters).
- Never write into `.paqad/ledger/feature-evidence/<change>/`. Author templates elsewhere;
  the compile/freeze/record verbs put the rigid artifact in the bundle.
- Never run `verify-backstop` by hand. It forks the stage ledger.
- The first edit on a clean tree scans the whole tree and can block on unrelated
  pre-existing violations. If that happens, make a non-code edit first (for example this
  file's progress tracker) to unblock, then proceed.

---

## 5. The one open decision

**DEC-1: what does "let paqad run it" do?**

`S3` asks the user how to get the output of a command like `php artisan route:list` when the
site map needs it. Two options:

- **Run it.** Paqad boots the project's app and reads the output. One click, and it executes
  project code.
- **Print it.** Paqad prints the command and waits for the user to paste the output back.
  Slower, and nothing of the user's runs unwatched.

Recommendation on record: **run it**, restricted to read-only commands, with print-and-paste
kept as a tray option for anyone who wants it. Never a command that writes.

**This decision is not yet resolved.** Before starting `S3`:

```
npx paqad-ai decision create \
  --category workflow-or-tool \
  --title "How paqad obtains the output of a project command the site map needs" \
  --context "<summarise the two options and the recommendation>" \
  --option run="Paqad executes the read-only command itself" \
  --option print="Paqad prints the command and waits for pasted output" \
  --recommendation run
```

Surface it with `AskUserQuestion`, wait for the answer, resolve it with
`npx paqad-ai decision resolve <id> <chosen> "<rationale>"`, and commit the resolved packet
with the change it justifies. Never hand-author the JSON: the writer mints the `D-<ULID>` id.

`S1`, `S2`, `S4`, `S5`, `S6`, `S7` do not depend on DEC-1. Do them while it is open.

---

## 6. The tasks

Each task below gives: the goal, which defect it fixes, the files, numbered acceptance
criteria, the tests required, and the commit message. The acceptance criteria are the
specification. Satisfy every one.

---

### S1: recompile the rulebook when it goes stale

**Fixes:** D1.
**Depends on:** nothing.
**Size:** small.

**Goal.** The agent can never be served a rule that no longer matches
`docs/instructions/rules/`.

**Files.**

- `src/context/rule-context.ts` (the refresh path around `writeRuleContext`, line ~182, and
  `refreshRuleContext` below it)
- `src/planning/rule-compiler.ts` (read only: `isCompiledRulesStale`, `compileRules`)
- `src/health/checker.ts` (add a check; leave `checkLeanRuleFootprint` alone)

**Acceptance criteria.**

1. In the rule-context refresh path, before the compiled store is read: if
   `isCompiledRulesStale(projectRoot)` is `true`, call `compileRules(projectRoot)` and
   persist the result, then read the fresh store.
2. The recompile happens **inside the existing single-flight lock** used by
   `refreshRuleContext`, so two concurrent refreshes cannot compile at once.
3. A failure to compile must not abort the refresh and must not throw. Catch it, and fall
   through to the existing behaviour: use the stale store if there is one, or prepend the
   existing rules-missing fallback marker if there is not. Rationale: one malformed rule file
   must never brick a session.
4. When the store is already current, `compileRules` is **not** called. (Test with a spy.)
5. New health check named `Compiled rules are current`. It **fails** (not warns) when
   `isCompiledRulesStale` is `true`, with a remediation sentence naming the command that
   fixes it. It passes otherwise.
6. `computeSourceHash`'s inputs are unchanged. The compiled-store format is unchanged.
7. `checkLeanRuleFootprint` keeps its current behaviour, including its size readout.

**Tests.**

- Stale store plus an edited rule file: the refresh recompiles, and the written
  `session-context.md` contains the new rule text, not the old.
- Current store: `compileRules` is not called.
- `compileRules` rejects: the refresh still writes an artifact and does not throw.
- Health check: stale gives `fail` with a remediation; current gives `pass`.

**Done when.** All four tests pass, `pnpm run ci` is green, and running the refresh in this
repository makes `.paqad/context/session-context.md` describe `docs/site-map/` rather than
`docs/instructions/site-map/`. Verify that by grepping the regenerated artifact.

**Commit.** `fix(rules): recompile the rule store when it goes stale (S1)`

---

### S2: honest verdict when the map is absent or has no links

**Fixes:** D4, and the stale path strings noted in D4's row.
**Depends on:** nothing.
**Size:** small.

**Goal.** The engine can no longer report a clean result about a map that does not exist or
that records no navigation.

**Files.**

- `src/site-map/verification.ts`
- `src/site-map/run.ts` (the result shape)
- `src/cli/commands/sitemap.ts` (what is printed)

**Acceptance criteria.**

1. When there is no stored map, `collectVerificationFindings` returns **no findings** (there
   is nothing to verify) and **one blocked check**: `check: 'map-present'`, a reason saying no
   map has been authored at `docs/site-map/app-map.yaml` yet, and an `install_hint` naming how
   to create one.
2. When a map exists but records zero transitions, add a blocked check
   `check: 'reachability'` with a reason saying the map records no navigation between screens,
   so reachability and dead ends cannot be checked. Keep the existing `hasGraph` short-circuit
   for the checks themselves: this criterion only makes the skip visible.
3. `SiteMapRunResult` gains `verdict: 'safe' | 'attention' | 'inconclusive'`, decided in this
   order:
   - `attention` when `finding_count > 0`
   - else `inconclusive` when there is no stored map, or the map has zero transitions, or
     `blocked_checks` is non-empty
   - else `safe`
4. The CLI prints the verdict in the paqad contract words: `Safe to merge`,
   `Needs your attention`, `Inconclusive`. The current unconditional
   "the map matches the code. Safe to merge." on zero findings is removed.
5. `verdict` is added to the machine-readable JSON summary line.
6. **Exit codes do not change:** `0` clean, `1` findings, `2` unexpected error. An
   `inconclusive` verdict with zero findings still exits `0`. Rationale: the freshness gate and
   other callers read the exit code, and changing it is a separate decision.
7. Every string in `src/site-map/verification.ts` that names
   `docs/instructions/site-map/app-map.yaml` (8 occurrences) is replaced with the canonical
   path from `PATHS.SITE_MAP_CANONICAL_APP_MAP`. That directory no longer exists, so the
   current fix-it text sends people to nothing.

**Tests.**

- No map: one `map-present` blocked check, zero findings, verdict `inconclusive`.
- Map with surfaces and zero transitions: `reachability` blocked check, verdict
  `inconclusive`.
- Map with transitions, zero findings, zero blocked checks: verdict `safe`.
- Findings present alongside blocked checks: verdict `attention`.
- Exit code is unchanged in each case.
- A finding's `resolution` text names `docs/site-map/app-map.yaml`.

**Done when.** Running `paqad-ai sitemap run` in this repository reports `Inconclusive` (this
repo's map has 112 surfaces and 0 transitions), not "Safe to merge", and `pnpm run ci` is
green.

**Commit.** `fix(site-map): honest verdict when the map is absent or has no links (S2)`

---

### S3: workflow preflight and one batched tray

**Fixes:** D5, D6.
**Depends on:** DEC-1 resolved (§5).
**Size:** medium. Split into three commits.

**Goal.** Before any mapping work, check everything the run needs, and put every unanswered
question to the user in a single interruption.

Build this **generic**. The user's requirement is that this covers all workflows, not just
the site map. `run.ts` must not know anything site-map-specific: the requirements come from a
registry that other workflows can add to without touching the runner.

**Files.**

- New: `src/workflow-preflight/contract.ts`, `registry.ts`, `run.ts`, `index.ts`
- New: `src/cli/commands/preflight.ts`, registered in `src/cli/program.ts`
- `src/site-map/prerequisites.ts` (reuse `detectSiteMapPrerequisites`, do not reimplement it)
- `src/site-map/creation-answers.ts`, `src/site-map/creation-flow.ts` (accept preflight answers)
- `src/core/types/site-map-answers.ts` (two new categories)

#### S3a: the contract and the runner

**Acceptance criteria.**

1. A requirement is declared as: a stable `id`, a human `label`, a `kind`
   (`'command' | 'file' | 'workflow'`), an async `probe`, a `why` sentence in plain language
   saying what the run loses without it, and an `options` array of `{ id, label, recommended? }`
   describing what to ask when the probe does not come back `ok`.
2. A probe returns one of: `'ok'`, `'unavailable'`, `'needs-decision'`.
3. **Probes are read-only and must not execute project code.** A probe may check that a file
   exists or that a binary answers `--version`. It must not run a project command that boots
   the app. See S3b criterion 3 for why.
4. `runPreflight(projectRoot, workflow)` returns
   `{ ok: boolean, requirements: PreflightRequirementResult[], questions: PreflightQuestion[] }`.
   `questions` holds every requirement that came back `unavailable` or `needs-decision`, in
   declaration order. `ok` is true only when `questions` is empty.
5. The registry maps a workflow name to its requirement list. Ship `site-map` only. A
   workflow with no declared requirements returns `ok: true` and no questions, never an error.
6. `paqad-ai preflight <workflow>` prints a human summary plus a machine-readable JSON line.
   Exit `0` when `ok`, `1` when there are questions, `2` on an unexpected error.

**Tests.** Each probe outcome; a workflow with no requirements; question ordering; the
all-`ok` case producing zero questions; the CLI exit codes.

**Commit.** `feat(preflight): workflow requirement contract and registry (S3a)`

#### S3b: the site-map requirements

**Acceptance criteria.**

1. Declared requirements for `site-map`:
   - `documentation-foundation` and `module-docs`, both delegating to the existing
     `detectSiteMapPrerequisites`. Do not re-derive them.
   - `node-cli-program`: the commander program is discoverable.
   - `laravel-route-list`: declared **only** when `composer.json` requires
     `laravel/framework`.
2. `laravel-route-list`'s probe checks **presence, not execution**: an `artisan` file exists
   and `php --version` exits `0`. It returns `'needs-decision'` when both are present, and
   `'unavailable'` when `php` is missing.
3. The probe must not run `php artisan route:list`. Getting the route list means booting the
   user's application, which is exactly what DEC-1 is about. Preflight asks first; the answer
   decides whether the gatherer runs it later.
4. `laravel-route-list`'s options follow DEC-1's resolution. Include the option the user did
   not pick as a non-recommended choice, plus a third: fall back to the static route-file
   scan, with the `why` sentence saying what that loses (module attribution and middleware,
   which only the real router resolves).
5. Every requirement's `why` is one plain sentence with no jargon, in the paqad voice.

**Tests.** A non-Laravel project does not declare `laravel-route-list`; a Laravel project
with `php` present gives `needs-decision`; without `php`, `unavailable`; the probe never
spawns `artisan` (assert on the process spawner).

**Commit.** `feat(preflight): site-map requirements and the batched question set (S3b)`

#### S3c: persist the answers

**Acceptance criteria.**

1. Two new categories in `SITE_MAP_ANSWER_CATEGORIES`: `tool-access` (how to obtain a
   command's output) and `journey-scope` (which journeys matter).
2. Preflight questions persist into the **existing** `docs/site-map/answers.yaml` store
   through the existing writer. Do not create a second answers file.
3. `recordCreationAnswers` currently rejects any decision whose `question_id` is not a
   current map candidate, and preflight runs before a map exists. Extend the candidate lookup
   to consult **both** `buildCandidateQuestions(map)` and a new
   `buildPreflightQuestions(preflightResult)`. A preflight answer carries `anchors: []`
   because it describes tooling, not code.
4. The existing guarantee holds: category and anchors are re-derived, never taken from the
   agent's input. A `human` answer stays `human`; a default or deferral records as `default`.
5. A settled `tool-access` answer is reused on later runs and is not re-asked. It is reopened
   only when the probe result changes (for example `php` appears or disappears).

**Tests.** Round-trip a preflight answer through the store; a map-less project records
successfully; an unknown id is still rejected; a settled answer is not re-asked; a changed
probe result reopens it.

**Commit.** `feat(preflight): persist preflight answers into the site-map answer store (S3c)`

---

### S4: report the surface inventory before any write

**Fixes:** part of D7 (this is the checklist S5 ticks off).
**Depends on:** nothing.
**Size:** small.

**Goal.** The run says how big the job is before it writes anything.

**Files.** `src/site-map/run.ts`, `src/cli/commands/sitemap.ts`, `src/dashboard/ops-jobs.ts`.

**Acceptance criteria.**

1. `gatherSiteMapReport` already has `extraction.surfaces.length`. Add an `inventory` block
   to the run result: `{ screens: number, groups: string[], guards: number }`. `groups` is the
   distinct set of module attributions the extraction found, sorted.
2. New verb `paqad-ai sitemap inventory` prints the inventory and a JSON line. It performs no
   writes, so it is safe to run any time.
3. The `site-map` ops job's first `progress()` message reports the inventory in a sentence a
   person can read, for example `Found 214 screens across 12 groups.` It replaces the current
   generic "Mapping the app" sentence.
4. **Do not report a journey count here.** Journeys are proposed by the model, not counted by
   the engine. Claiming a deterministic journey count would be a false precision. The journey
   list is recorded at draft time (S8) and lands in the progress file then.

**Tests.** Inventory over a fixture extraction; empty extraction gives zeroes and an empty
`groups`; the CLI JSON line shape; the ops progress sentence.

**Commit.** `feat(site-map): report the surface inventory before any write (S4)`

---

### S5: progress store with crash recovery

**Fixes:** D7.
**Depends on:** S4.
**Size:** medium. Split into two commits.

**Goal.** The same prompt in a new session continues instead of restarting, and a run that
died mid-write can never leave a half-written file looking finished.

**This is a copy, not an invention.** `src/document/progress-tracker.ts` already implements
this pattern, including the reset. Read it first and follow its shape. The security-test
workflow does the same thing per run.

**Files.**

- New: `src/core/types/site-map-progress.ts`, `src/site-map/progress-store.ts`
- New: `src/validators/schemas/site-map-progress.schema.json`
- `src/core/constants/paths.ts`: add `SITE_MAP_PROGRESS: '.paqad/site-map/progress.json'`
- `src/cli/commands/sitemap.ts`: the `status` verb

#### S5a: the store

**Acceptance criteria.**

1. Persisted shape:

```
{
  schema_version: '1',
  generated_by: 'paqad-ai',
  framework_version: string,
  created_at: string,          // ISO
  updated_at: string,          // ISO
  inventory: { screens: number, groups: string[] },
  units: Record<string, SiteMapProgressUnit>
}

SiteMapProgressUnit = {
  id: string,                  // 'group:billing' | 'journey:checkout-guest' | 'stage:links'
  kind: 'group' | 'journey' | 'stage',
  label: string,
  state: 'not_started' | 'writing' | 'done' | 'failed',
  started_at: string | null,
  completed_at: string | null,
  artifact: string | null,     // posix, repo-relative; the file this unit writes
  source_files: string[],      // posix, repo-relative
  source_hash: string | null,
  error: string | null
}
```

2. Tolerant read. A missing, unparseable, or schema-invalid file reads as "no progress yet"
   and never throws. Follow the discipline in `src/site-map/store.ts` and the code-knowledge
   store.
3. Atomic write: temp file plus rename. Reuse `writeJsonFile` from `src/site-map/shared.ts`.
4. **Crash recovery, on load.** Every unit in `state: 'writing'` is reset to `'not_started'`,
   its `started_at` and `error` cleared, **and the file named by its `artifact` is deleted**.
   A `writing` unit must never be treated as done. This is the criterion that makes resuming
   safe rather than merely faster: without it, a run that died mid-write leaves a truncated
   journey file that reads as complete forever.
5. **Skip rule.** A `done` unit whose `source_hash` still equals the current hash of its
   `source_files` is skipped on the next run. A `done` unit whose hash has changed is reset to
   `not_started`, because the code it describes moved.
6. This module is the only writer of `.paqad/site-map/progress.json`.
7. `.paqad/site-map/` is **already git-ignored** (`.paqad/.gitignore:47`). Do not add a
   gitignore entry. The file is deliberately local: a person resumes their own sessions, and a
   teammate starts fresh. That keeps the shared folder quiet and matches the call the other
   workflows already made.

**Tests.** Every state transition; the reset-and-delete on load, asserting the artifact file
is gone; hash match skips; hash change resets; a corrupt file reads as empty; a
schema-invalid file reads as empty; two writes do not interleave.

**Commit.** `feat(site-map): progress store with crash recovery (S5a)`

#### S5b: the status verb

**Acceptance criteria.**

1. `paqad-ai sitemap status` prints: total units, done, writing, failed, remaining, and the
   id and label of the next unit to work on. Plus a JSON line.
2. With no progress file it says so plainly and reports that a run would start from the
   beginning. Exit `0`.
3. It always exits `0`. It is a readout, not a gate.
4. It performs no writes, including no crash-recovery reset. Rationale: `status` must be safe
   to run at any moment, including while a run is in flight. The reset belongs to the run.

**Tests.** Populated file; absent file; a file with a `writing` unit (reported as writing, and
**not** reset by `status`); the JSON shape.

**Commit.** `feat(site-map): sitemap status reads the progress file (S5b)`

---

### S6: show the run progress in the dashboard

**Fixes:** the progress half of D8.
**Depends on:** S5.
**Size:** small.

**Goal.** While a run works, the Site map area says how far along it is.

**Reuse, do not rebuild.** `graph-ui/src/components/OpButton.tsx` already starts a job,
subscribes to the `ops-progress` SSE stream, renders the latest message, and polls as a
backstop. Three other views use it. Do not write a second polling or SSE mechanism.

**Files.** `graph-ui/src/views/SiteMapView.tsx`, `graph-ui/src/lib/api.ts`,
`graph-ui/src/lib/dashboard-types.ts`, the dashboard server route module,
`src/dashboard/ops-jobs.ts`.

**Acceptance criteria.**

1. Server: `GET /api/site-map/progress` returns the progress file, or `null` when there is
   none. A static read with no model call, safe on every poll, matching how
   `buildSiteMapView` behaves.
2. The `site-map` ops job emits one `progress()` per completed unit, worded for a person:
   `Journey 8 of 12: Checkout, guest`.
3. `SiteMapView` renders an `OpButton action="site-map"` and, when a progress file exists, a
   strip showing: the current unit, a done / writing / remaining count, and one line naming
   what was skipped because a previous session finished it.
4. With no progress file, render nothing. Not an empty bar, not a zeroed count.
5. No new dependency, no new state library. Local component state and the existing fetch
   helpers.

**Tests.** `graph-ui` tests: the strip with a populated payload; nothing rendered on `null`;
the skipped-count line. Server test: the route returns the file and `null` correctly.

**Done when.** `pnpm run graph-ui:test` and `pnpm run ci` are green.

**Commit.** `feat(dashboard): show site-map run progress (S6)`

---

### S7: full-screen map and a readable zoom floor

**Fixes:** the full-screen half of D8.
**Depends on:** nothing.
**Size:** small.

**Goal.** The map can have the whole window, and its cards are big enough to read.

**Files.** `graph-ui/src/views/SiteMapView.tsx`,
`graph-ui/src/components/SiteMapCanvas.tsx`, `graph-ui/src/components/DashboardChrome.tsx`.

**Acceptance criteria.**

1. A `Full screen` button in the Site map header, plus `f` to toggle and `Escape` to exit.
2. In full screen, all four pieces of chrome are hidden together: the sidebar, the title band
   with its why-sentence, the honesty strip, and the journey picker band. The journey picker
   and the canvas controls are floated over the canvas as one bar. An exit control is always
   visible.
3. Use the browser Fullscreen API when it is available, with a CSS fallback (a fixed,
   full-viewport container) when the call is rejected. The dashboard may be embedded, where
   the API can be blocked, and the button must still work.
4. Raise `minZoom` in `SiteMapCanvas.tsx` from `0.05` to `0.25`. At 5% a surface card is an
   unreadable speck. Leave `fitViewOptions.padding` as it is.
5. Because of criterion 4, a very wide map can no longer be fitted entirely in view. When
   `fitView` hits the floor, show one line saying the map is larger than the window and
   pointing at the existing minimap. Readable beats complete.
6. Respect `prefers-reduced-motion` for the enter and exit transition.
7. **Do not persist the full-screen preference.** A page load must never open trapped in full
   screen.

**Tests.** `graph-ui` tests: toggle by button, by `f`, exit by `Escape`; chrome hidden in
full screen and restored on exit; the fallback path when the Fullscreen API rejects; the
over-size hint appears only at the zoom floor.

**Commit.** `feat(dashboard): full-screen site map and a readable zoom floor (S7)`

---

### S8: a command that drafts the map

**Fixes:** D2.
**Depends on:** S4, S5.
**Size:** large. Split into three commits.

**Goal.** The engine writes the map skeleton from what it already extracted, so the model
adds meaning instead of retyping hundreds of entries.

**Files.** New `src/site-map/draft.ts`; `src/cli/commands/sitemap.ts`;
`src/cli/program.ts`.

#### S8a: write the skeleton

**Acceptance criteria.**

1. `paqad-ai sitemap draft` writes a schema-valid `docs/site-map/app-map.yaml` containing one
   surface entry per extracted surface: `id` (from `raw_id`), `kind`, `label`, `evidence` (the
   extractor's real `file:line`, unchanged), `entry`, `module` when the extractor revealed
   one, and `guards` from the middleware hints.
2. Areas are derived from the module map. `schema_version` is the integer `1`, not a string
   and not `0-draft`.
3. **It must not invent.** No transitions, no journeys, no actors it cannot ground in
   evidence. Those are the model's job, and links arrive in S9.
4. It writes through the existing `writeCanonicalSiteMap`, which validates before persisting,
   so a schema-invalid draft can never land on disk.
5. Never write into a feature bundle directory. Never write a timestamped report.
   `docs/site-map/` holds only the current map.

**Tests.** Draft from a fixture extraction produces a map that passes `validateAppMap`;
evidence pointers are preserved byte-for-byte; no transitions or journeys appear; an invalid
draft is refused rather than written.

**Commit.** `feat(site-map): draft the map skeleton from the extraction (S8a)`

#### S8b: make it additive and resumable

**Acceptance criteria.**

1. Re-running `draft` **merges**. An existing surface entry keeps every human-authored field
   (`title`, `note`, a curated `label`, provenance stamps). Only missing entries are added.
   Authored content is never clobbered.
2. A surface the extraction no longer sees is **not deleted**. Leave it; the existing
   `SM-REMOVE` finding already reports it, and deleting a person's authored entry on a bad
   scan would be destructive.
3. `draft` seeds the progress file from the S4 inventory on first run, and marks each group
   unit `writing` then `done` as it goes, recording that group's `source_files` and
   `source_hash`.
4. `draft` **resumes by itself**: it skips `done` units whose hash is unchanged. An agent
   that forgets to run `status` still cannot restart from zero. This is deliberate: a rule
   that says "check progress first" is exactly the kind of instruction D1 shows can go stale,
   so the guarantee lives in code.
5. Interrupting `draft` leaves the in-flight unit as `writing`, which S5a's loader then resets
   and cleans up on the next run.

**Tests.** Merge preserves authored fields; a vanished surface survives; the progress file is
seeded and advanced; a second run skips unchanged groups; an interrupted run leaves exactly
one `writing` unit.

**Commit.** `feat(site-map): draft resumes from the progress file (S8b)`

#### S8c: unhide the command

**Acceptance criteria.**

1. `src/cli/program.ts:65` no longer registers `sitemap` with `{ hidden: true }`.
2. `paqad-ai sitemap --help` lists `run`, `draft`, `inventory`, `status`, `questions`,
   `answer`, `journey`.
3. Every verb's description is one plain sentence, no jargon.

**Tests.** The help output includes `sitemap` and each verb.

**Commit.** `feat(cli): unhide the sitemap command (S8c)`

---

### S9: find the links in the code

**Fixes:** D3. This is the change that makes the map worth opening.
**Depends on:** S8.
**Size:** large. Split into three commits.

**Goal.** Links come from the code, not from hand-typing.

**Files.** New `src/site-map/transitions.ts` (pure detectors, no I/O, mirroring how
`extraction.ts` is structured); `src/site-map/gatherer.ts` (the impure gathering);
`src/site-map/assemble.ts` (reconciliation).

#### S9a: the detectors

**Acceptance criteria.**

1. New type `ExtractedTransition { from_raw_id, to_target, trigger, evidence: Evidence[], confidence }`,
   where `to_target` is the raw route name, path, or command name as written in the code.
   Resolution to a surface id happens in S9b.
2. `transitions.ts` is **pure**: no filesystem, no shell, no network. All gathering lives in
   `gatherer.ts`. This is the same split `extraction.ts` already uses, and it is what keeps
   every branch testable with fixtures.
3. **The evidence rule is unchanged and is not negotiable:** a transition is recorded only
   when a resolving `file:line` shows navigation actually occurring. A bare href, an import, or
   a string that looks like a path is not navigation.
4. Ship these detectors, each with fixtures:
   - Laravel: `redirect()->route('name')`, `redirect('/path')`, `to_route('name')`,
     `Inertia::render('Page')` and `view('name')` inside a controller action that a route maps to
   - React Router: `navigate('/path')`, `<Link to="/path">`, `<Navigate to="/path">`
   - Node CLI: a command that invokes another command
5. Confidence is `high` for a framework navigation call, `low` for a convention-based match.

**Tests.** One fixture per detector, plus a negative fixture per detector proving a
non-navigational match is not recorded.

**Commit.** `feat(site-map): transition detectors for Laravel and React Router (S9a)`

#### S9b: resolve targets to surfaces

**Acceptance criteria.**

1. Resolve each `to_target` to an existing surface by matching against surfaces' `entry`
   values (a route name, a URL path, a command name).
2. An unresolvable target is **dropped, never guessed**.
3. Dropped targets are counted and reported as a blocked check naming how many links could
   not be resolved and why, so the gap is visible instead of silent. This is the same
   discipline D4 was fixed for.
4. Resolved transitions are written by `draft` (S8) into the surfaces' `transitions` arrays,
   each carrying its evidence.

**Tests.** Resolution by route name, by path, by command name; an unresolvable target is
dropped and counted; the blocked check appears with the right count.

**Commit.** `feat(site-map): resolve transition targets to surfaces (S9b)`

#### S9c: reconcile missing links

**Acceptance criteria.**

1. New finding category `SM-EDGE-MISSING`: a transition the code proves but the stored map
   does not record. Do **not** overload `SM-ADD`, which is surface-only today.
2. With transitions now present, `hasGraph` becomes true and the reachability and dead-end
   invariants start firing for real. This will produce new findings on existing maps. That is
   correct. The baseline ratchet marks them `pre-existing` on the run after the baseline is
   written.
3. Re-running `sitemap run` on this repository after S9 must report a non-zero transition
   count and a verdict that is no longer `inconclusive` for the "no links" reason.

**Tests.** A map missing a proven edge raises `SM-EDGE-MISSING`; a map recording it does not;
reachability findings appear once transitions exist; the baseline ratchet classifies them.

**Commit.** `feat(site-map): reconcile missing links as findings (S9c)`

---

### S10: rewrite the workflow rule

**Fixes:** the instruction half of D1, and documents everything S3 through S9 built.
**Depends on:** S3, S5, S8, S9.
**Size:** small, but easy to get wrong. Read every criterion.

**Files.**

- `runtime/capabilities/coding/rules/site-map.md` (the shipped runtime pack)
- `docs/instructions/rules/coding/site-map.md` (the mirror)

**Acceptance criteria.**

1. **Both files must end up byte-identical.** `docs/instructions/rules/` is a mirror of the
   runtime pack, and `paqad-ai refresh --rules --force` clobbers the mirror from the pack.
   Edit the pack, then copy it to the mirror, then diff the two to prove they match.
2. Editing anything under `docs/instructions/` invalidates the entry sentinel
   `.paqad/.agent-entry-loaded`. Re-arm it after this commit or your next edit is blocked.
3. The workflow steps become, in order:
   - **Step 0, always first:** `paqad-ai sitemap status`. A run never starts from zero when
     progress exists. Say this explicitly.
   - Step 1: `paqad-ai preflight site-map`, then put every returned question to the person in
     **one** `AskUserQuestion` call. Never one at a time. Record with `sitemap answer`.
   - Step 2: `paqad-ai sitemap inventory`. Say the size out loud.
   - Step 3: `paqad-ai sitemap draft`. The engine writes the skeleton; the agent then adds the
     meaning the code does not carry (titles, semantic slugs, module intent).
   - Step 4: journeys, one at a time, each narrated as it lands.
   - Step 5: `paqad-ai sitemap run` to verify and stamp trust and freshness.
   - Step 6: the receipt, in the contract verdict words.
4. Remove every claim that the verb authors the whole map. State it precisely: `sitemap draft`
   writes the skeleton from proven extraction, the agent adds meaning, `sitemap run` proves it.
5. Narration: one heading plus one short line per journey, in the agent's own visible
   assistant text, carried in the **final message of the turn**. A hook `systemMessage` is not
   a channel the developer reliably sees, and on Desktop it leaks as `Stop says:` prose.
6. On a resumed run, the first narrated line says what is being skipped and why, for example
   `Skipping 7 journeys finished on Monday.`
7. No path in the rule may name `docs/instructions/site-map/`. The map lives at
   `docs/site-map/`.
8. After this commit, S1's automatic recompile picks the new rule text up on the next session
   with no manual step. Verify by regenerating the session context and grepping it for the new
   Step 0 wording.

**Tests.** The rule-parity test that compares the pack against the mirror must pass. Add an
assertion that the rule text contains `sitemap status` and does not contain
`docs/instructions/site-map`.

**Commit.** `docs(site-map): rewrite the workflow rule for the resumable flow (S10)`

---

## 7. Definition of done for the whole PR

Every box must be true before asking for review.

- [ ] All ten tasks complete, each in its own commit (or its named sub-commits).
- [ ] One branch, `feat/site-map-rebuild`. One PR against `main`. No force-pushes.
- [ ] `pnpm run ci` green locally on the final commit.
- [ ] All CI checks green, including Windows and macOS.
- [ ] Coverage floors met: 95% repo-wide, 100% for `src/stage-evidence/**`.
- [ ] A changeset committed, `npx changeset status` clean.
- [ ] DEC-1 resolved, and the resolved packet committed with the change it justifies.
- [ ] `progress.md` fully updated, with a commit hash against every task.
- [ ] Running `paqad-ai sitemap status` in this repository reports real progress.
- [ ] Running `paqad-ai sitemap run` in this repository reports a non-zero transition count
      and a verdict that is not `inconclusive` for the "no links" reason.
- [ ] `.paqad/context/session-context.md`, regenerated, describes `docs/site-map/` and the
      new Step 0. No occurrence of `docs/instructions/site-map`.
- [ ] The Site map dashboard area has a working full-screen toggle and shows run progress.
- [ ] The PR body lists the eight defects D1 to D8 and which commit closes each.

---

## 8. Things that will bite you

Collected from previous work in this repository. Read before the first commit.

1. **Two test runs at once produce fake failures** with impossible timings. One run at a time.
2. **The first edit on a clean tree** scans the whole tree and can block on unrelated
   pre-existing violations. Make a non-code edit first (updating `progress.md` counts) to
   unblock.
3. **`export SE_SESSION=$CLAUDE_SESSION_ID`** before every `stage`, `plan`, `spec` or `review`
   call, or the gate never sees your stages and blocks your edits.
4. **`spec freeze` categorises by section heading**, not line prefix. Use
   `## Functional requirements` with `- INV-1:` entries, colon included.
5. **`plan compile` refuses a template without a `reuse` section** carrying `consulted`,
   `reusing` and `new_constructs`.
6. **Never run `verify-backstop` by hand.** It forks the stage ledger.
7. **Never hand-author a decision packet.** Use `paqad-ai decision create`; it mints the
   `D-<ULID>` id.
8. **`refresh --rules --force` clobbers `docs/instructions/rules/`** from the runtime pack.
   Edit the pack first, then mirror.
9. **Editing `docs/instructions/**` invalidates the entry sentinel.** Re-arm it.
10. **A word/word pattern plus "no longer exists"** in a spec trips a critical
    formula-detector block. Reword rather than fighting it.
11. **`.mjs` files used as hooks need the exec bit.**
12. **Posix paths in stored data.** `:` is illegal in Windows filenames.
