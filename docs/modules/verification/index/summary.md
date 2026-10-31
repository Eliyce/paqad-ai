# Verification Gates

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `verification`

## Purpose

Because there is no second human reviewer, paqad's own checks carry all the
weight — so the framework needs a single, deterministic answer to "is this change
allowed to land?" This module is the **gate runner** and the **bank of gates**
that produce that answer. Each gate inspects the change and returns a pass / block
verdict with computed judgment inputs; the runner aggregates the verdicts,
computes a delta versus the last run, and emits the evidence that the
[`evidence-ledger`](../../evidence-ledger/index/summary.md) and the per-change
receipt consume. Gates fire from hooks, with a git/CI backstop so the result binds
even when the agent is out of the loop.

## The bar

A gate's verdict is only trustworthy if its inputs are computed, not asserted.
Every gate therefore returns its judgment inputs alongside the verdict, and the
runner records **why** a gate passed or blocked — not just the boolean. A blocked
or inconclusive gate downgrades the run; it never hides inside a pass total. The
strength of each verdict (deterministic vs LLM-judged) is graded downstream by the
evidence ledger, never pooled.

## How the completion (Stop) hook stays safe

The Claude Stop-hook layer (`runtime/hooks/verification-completion.mjs` →
`runtime/scripts/verify-backstop.mjs`) is a **fast-feedback** layer, not the
binding one — the git/CI backstop is the non-bypassable teeth. Three rules keep it
from turning into a nuisance:

- **It reads the flag from the right place.** The hook resolves the project root
  via `CLAUDE_PROJECT_DIR` / `PAQAD_PROJECT_ROOT` (cwd fallback), the same shared
  helper the sibling Stop hooks use — so a project set to `paqad_enable=false` is
  honored even when the host launched the hook from a subdirectory (fix #1).
- **It bites once, never loops.** A blocking verdict exits 2 so the host surfaces
  it to the model and gives it a turn to fix. If the next Stop is a continuation
  of that block (Claude's `stop_hook_active`), the gate steps aside — it surfaces
  the summary but exits 0, so an unresolvable verdict (a missing canonical doc, an
  unrecordable stage) can never wedge the session in an infinite Stop loop (fix
  #2, `runtime/hooks/lib/loop-guard.mjs`). The same guard covers the
  capability-gate completion seam. The hard, non-bypassable check remains at
  git/CI.
- **It checks only the session that owns the change.**
  `runRepositoryVerification` asks `classifyCompletionEnforcement`
  (`src/pipeline/session-ownership.ts`) first. A session with no agent-written stage
  rows of its own in an unclosed bundle (or in the closed-then-reopened bundle its
  control points at) is skipped with the audit reason `not-owner`,
  so a question in a second session is never held to another session's change. An
  owner on a non-feature turn that edited nothing this turn is skipped as `detour`.
  Both skips are logged by `src/session-ledger/non-feature-skip-audit.ts`. This
  replaced an older guess, which tried to prove "not feature-development" from
  state every session shares.

## Who speaks the receipt

The completion hook writes the ledger and computes the verdict, but it does **not**
speak in chat. It used to echo the receipt on Claude's `{systemMessage}` channel,
which the Desktop app once recorded as a hook attachment it never rendered — a
verified six-stage run emitted eleven `▸ paqad` stage lines and the developer saw
none of them, while the evidence bundle was complete. Claude Code later flipped
that: a Stop-hook `{systemMessage}` now renders verbatim as `Stop says:` lines, so
the echo went from invisible to a loud duplicate of the receipt the agent already
speaks, and it leaked the model-only narration advisory into the chat. Either way
the hook is the wrong mouth. So the Stop hooks no longer emit user-facing
`{systemMessage}` prose at all; they write the ledger and, on a hard failure, ride
the model-only `{decision:'block'}` reason.

So the voice belongs to the agent, and the hook keeps a deterministic backstop:

- **The agent speaks.** The narration contract instructs the Claude Code agent to
  emit its own `▸ paqad` stage lines and the one end-of-change receipt in visible
  assistant text, placed in the turn's **final** message — mid-turn text between
  tool calls is not reliably rendered either.
- **The hook checks that it did.** `src/stage-evidence/narration-audit.ts` reads the
  turn transcript and reports every stage recorded this turn that carries no
  matching visible stage line in an assistant **text** block. A line found only in a
  hook attachment or `systemMessage` payload does not count as visible.
- **The check is advisory, never a gate.** An unnarrated turn is a voice defect, not
  a broken change, so the finding rides along as an instruction to the model (folded
  into the `{decision:'block'}` reason when a real gate is already blocking) and can
  never turn a passing verdict into a failing one or block a turn. A missing,
  unreadable, or malformed transcript yields no findings at all.

The Stop hooks emit no user-facing `{systemMessage}` prose: since Claude Code renders
a Stop `{systemMessage}` as `Stop says:` lines, an echo there would only duplicate the
agent's receipt and leak model-only advisories. The agent's final message is the sole
developer-facing channel; enforcement rides `{decision:'block'}` plus the git/CI backstop.

### paqad keeps its own receipt every turn

The in-session Stop backstop (`runtime/scripts/verify-backstop.mjs`, `hook-completion`)
still prints nothing on a clean or Inconclusive turn. It now writes the composed receipt,
the same text the git and CI backstop prints, to `.paqad/session/hud/<session>.receipt.md`,
and the verdict (word, kind, passed, reasons) to `.paqad/session/hud/<session>.verdict.json`,
through `writeHudReceipt` in `src/hud/receipt-file.ts`. A failed write is logged to
`.paqad/logs/hook-failures.log` and never changes the `{decision:'block'}` or the exit code.

A turn whose check was skipped writes neither file. The not-owner and detour
skip verdict carries `applicable: false`, and `writeHudReceipt` returns null for it, and for
any verdict with no gates and no decided kind, which would otherwise read as Safe to merge.
The previous HUD files stay as they were, so a question asked after a graded change keeps
showing that change's real verdict.

## One verdict rule

`verdictKindFor` in `src/verification/verdict-kind.ts` decides the verdict word for every
surface: any failed gate is Needs your attention; otherwise any inconclusive gate, or any
unrecorded mandatory stage, is Inconclusive; otherwise Safe to merge. Skipped gates never
move it.

- The chat receipt (`formatVerdictSummary`) uses it.
- `report.html` is re-rendered after the final verdict with that word, since its first
  render runs before the late gates exist. Rendered on its own (`paqad-ai feature report`),
  it applies the same rule to the bundle's gate rows, sealed or not.
- The `paqad-ai evidence` PR comment uses it on the evidence gates plus the persisted
  `unrecorded_mandatory_stages`. `overall_status`, which folds inconclusive into `fail` for
  `--fail-on-red` and CI blocking, is unchanged; only the printed word follows the rule.

## The gate bank

The gates under `src/verification/gates/` cover correctness, completeness, quality,
and documentation:

| Gate | Concern |
| --- | --- |
| `ac-test-mapping` | Every automated acceptance criterion in the frozen spec is named by a test changed on the branch, read from the change map (see [`traceability-engine`](../../traceability-engine/index/summary.md)). |
| `behavioral-correctness` | The change does what the spec says. |
| `change-completeness` | The change is whole — no half-applied edits. |
| `code-tests-lint` | Tests, types, and lint pass. Read from the `paqad-ai checks run` report; a report that names a tree different from the current one (or one the gate cannot confirm in 10 s) reads Inconclusive and does not count as verified checks, while a report without a tree keeps its verdict (see [`check-runner`](../check-runner.md)). |
| `mutation-testing` | Tests would actually catch a behaviour-changing mistake. Opt-in through `mutation_mode` (default off) and measured only on the `ci-backstop` / `git-backstop` origins a project wires itself; otherwise not required. |
| `quality-ratchet` | No quality measure regresses (see [`quality-ratchet`](../../quality-ratchet/index/summary.md)). |
| `requirement-completeness` | Requirements are fully addressed. |
| `spec-review` / `story-quality` | LLM-judged quality of the spec and the story. |
| `implementation-review` | LLM-judged quality of the implementation — **plus** a deterministic part: the gate fails when a deterministic, file-anchored, high-severity machine finding is never cited by `file:line` in the recorded `review.json`. Ignoring the machine is detectable; the verdict itself is still judgment. |
| `architecture-compliance` / `database-quality` / `extension-surface` | Structural and contract conformance. |
| `documentation-freshness` / `documentation-checks` / `instructions-docs-structure` / `module-docs-structure` | Docs are present, current, and well-formed. |

### Pending decisions and the last source edit

On the hook and backstop path the implementation-review signal comes from the decision store
(`computeImplementationReview` in `src/verification/repository/judgment-inputs.ts`). A pending
decision opened before the change's last source edit blocks the change, because the agent kept
editing past an open question. A pending decision opened after the last source edit is not a
defect: it is the agent pausing as it should, so it goes on a waiting list instead. The last
source edit is the latest `development` row in the active bundle, else the newest modified
time of the changed files outside `.paqad/`, else unknown (`lastSourceEditAt` in
`repository-context.ts`). When it is unknown every pending decision blocks, as before. The
receipt prints one line per waiting decision after the skip lines, with the skipped glyph:
`a decision is waiting for you: D-<id> (<category>): <question>`. Those lines never change the
counts or the verdict word.

### The late gates

Three evidence gates run after the bank, at the completion seam, because they read files the
seam itself writes: `bundle-completeness`, `visual-evidence` (see
[`visual-evidence`](../../visual-evidence/index/summary.md)) and `rules-loaded`. Each is recorded
in the active bundle's `evidence.jsonl` too, one row per gate, skips included (verdict
`skipped`, the skip reason as the detail), like the graded rows always on whatever the
enterprise toggles. When the visual-evidence gate has no bundle to read it
records nothing.

`rules-loaded` fails a feature-development change with no `rules-loaded.json` at the
`hook-completion` and `git-backstop` origins. At `ci-backstop` no agent session runs, so
nothing could have loaded the rules there: with no record the gate is skipped as not required,
with the detail "No session loads rules on CI, so the load was not required here." A record
that does exist is still judged on CI (pass, or inconclusive when it is stale).

The stage-evidence and checks (`code-tests-lint`) gates are recorded with them, and when the
only gap is an unrecorded mandatory stage, an inconclusive `unrecorded-mandatory-stages` row is
added too. The bundle receipt and AI-BOM are sealed only after all of that, from
rows for every gate the verdict read, and before the verdict is built. So `receipt.json`'s
`verification_result` (PASSED, FAILED, INCONCLUSIVE) says the same thing as the HUD verdict
file and the HUD receipt. Because the receipt is written after `bundle-completeness` runs,
that gate counts a missing `receipt.json` or `ai-bom.json` as present when this run is about
to seal it. If the seal then fails, `recheckAfterReceiptSeal` judges the bundle again without
that allowance and records the new row, so a strict gate still fails for the missing file and
every surface reads the re-judged gate.

A blocked row (a measure that could not be taken) stays listed on the receipt but does not
make it Inconclusive; only an inconclusive row does (decision D-01M5A0MG6537XJ7S3MD3Q4PSCR).
That keeps the receipt in step with the HUD verdict, which reads gate statuses only.

### Not required and did not run

A gate that measured nothing never reads as a pass. It says one of two things:

- **Not required**: the change gave it nothing to check. For example no instruction or module
  doc changed, no public export barrel changed, no duplication scan ran, no code changed
  (`change-completeness`, and `code-tests-lint` on a docs-only change), no rule applies, a
  change with no frontend file under `visual-evidence`, or mutation testing is off.
- **Did not run**: a check was owed and did not happen. For example the mutation tool is not
  configured or the test command was red, every quality ratchet measure was blocked, or a gate
  this seam does not judge (the placeholder for a gate with no result).

A gate result says so with `createNotRequired` or `createDidNotRun`
(`src/verification/gates/shared.ts`). Both keep `passed: true`, so the gate runner never
treats them as the first failure and no verdict kind changes; the evidence records them on
the existing `skipped` status with a `skip_kind` of `not-required` or `did-not-run`
(decision D-01M5AM0E9YEC7FBFHFN8N3SHCC). A skipped row written before Part 10 has no
`skip_kind` and reads as not required.

Every surface counts only the required gates that ran. The verdict summary's "N/M checks
held" leaves both kinds out. It prints one `⚪ <gates>: did not run (<reason>)` line per
reason for every gate that did not run, and a `⚪ <gate>: not required (<reason>)` line only
for a gate whose feature flag is on (today `visual-evidence`), after the status lines and
before the escalations. The line also appears when the summary is re-formatted for the
receipt. The PR comment reads `Gates: N passed, F failed, I inconclusive, R not required, D
did not run.`, leaves a not-required trust gate out and shows a did-not-run one in grey. The
`report.html` receipt table shows skipped rows grey as "not required" or "did not run", and
the HUD gate list reads `did-not-run` or `not-required` (only `not-required` is
`required: false`). Neither kind is graded a pass or cited as compliance evidence.

### Proven against the built bundles

The Stop hook imports the depth-one `dist/index.js`, while the CLI runs the depth-two
`dist/cli/index.js`. The package root is found by walking up to the `package.json` named
`paqad-ai` (`src/core/runtime-paths.ts`), so both resolve the same runtime folder.
`tests/e2e/dist-runtime-root.e2e.test.ts` imports the built bundles and runs the real
`verify-backstop.mjs` on a fixture, so a wrong root fails loudly instead of reading as "no
packs, nothing to check".

## Gate states and record ownership

Each gate reads one of five states, set by one status mapper: pass, fail, could not prove, did
not run, or not required. A gate skipped after an earlier failure is recorded as did not run. A
gate that no paqad path runs is not listed at all.

The verdict keeps two kinds of trouble apart. Problems in the work fail or stop the change.
Problems in paqad's own record are paqad's gap, not the work's. The verdict record carries
`work_kind`, `record_gaps` and `repairs` for this; its `kind` and the Stop block are unchanged.
The verdict is written with its change before the close, and a finished change stays on the HUD
until a new change has its own result. Old stray changes are left as they are and labelled as
paqad's gap. `checks run` pins its report to the change it started on.

### Session and turn rules

- A stage mark after a close reattaches to the session's own change on the same branch; a new
  change copies the session's lane.
- At turn end, edit stages end on their own; only a checks stage that has not reported stays open.
- The Stop check waits (defers) only for paqad stage agents, untyped background tasks while a stage
  is open, or a live checks marker tied to the session, the change and the process. A wait seen
  only in the payload or the checks marker has a 30-minute ceiling, counted across turns from the
  first deferred Stop after the last judged Stop. A stage agent the change's ledger shows as
  started and not released, and a turn end between stages, have no clock (see the feature-evidence
  module).
  This restores the owner's earlier rule and replaces the spec's "any background task" wording.
- Background stage agents get the permissions they need to write their records.

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file in `src/verification/`.

**`evidence-markdown.ts`.** Glyphs and verdict words come from `src/core/constants/paqad-voice.ts`,
so the PR comment, the dashboard and the chat narration speak one language; the maps here only
translate each surface's status enum onto those glyphs. The trust gates (tests, mutation, quality)
are shown even when green, in a fixed order, because the green facts are what a reviewer wants
first. Numbers such as the kill rate are printed straight from each gate's `detail`, never
re-parsed, so the comment never claims a figure the evidence does not hold. The output is pure and
byte-identical for identical evidence (no timestamps, no locale calls), so it can feed the signed
receipt. Compliance citations are listed once per framework and clause and always read "evidence
toward", never "compliant". The authorship footer names the accepter only; the email already
lives in the receipt and git history. A full commit SHA is shortened to seven characters; a tag or
branch label is left as is.

**`gates/change-completeness.ts`.** Test-evidence strength needs structured test results, which
only the in-session agent records. At a backstop origin with none, the gap is raised as an
escalation by the repository context instead of a false "incomplete" block. Out-of-scope files
are listed by path so a human can accept or reject them.

**`gates/documentation-checks.ts`.** A drift doc the diff did not touch is an obligation only if
it already exists. The detector names framework-assumed owners (`docs/maintainers/architecture-map.md`,
`docs/modules/README.md`) that onboarding never creates, so demanding them would block every
onboarded repo. Required per-module docs are enforced by the expected-modules checks instead.

**`gates/duplication.ts`.** The checks-stage rule script runs `duplication scan`; this gate only
reads the cached report, so the same verdict reaches the receipt. It fails only on a blocking
report (strict mode with a deterministic finding), so the default warn bake-in never blocks.

**`gates/implementation-review.ts`.** The anchoring check is deliberately blunt: it searches every
field the recorded review filled, asking "did the reviewer look at this place?", not whether the
prose is good. Only deterministic, file-anchored, high-severity rows can trigger it, so a change
with no machine findings behaves as before.

**`gates/module-docs-structure.ts`.** A flat `docs/modules/<module>/features/<feature>.md` layout
is accepted once a flat doc not part of this change already exists, because then the change did
not introduce the layout and blocking would force the agent to revert a correct doc sync. A lone
flat doc in an otherwise nested repo still fails.

**`gates/mutation-testing.ts`.** Survivors escalate (inconclusive) by default; `mutation_strict`
turns them into a block, so survivors do not stop work before baselines exist. Equivalent mutants
are set aside by the tool. A dirty working tree after the run means a mutant may be left behind,
so the gate fails whatever the mode. A weakly tooled language shows its result but is never
over-trusted.

**`gates/site-map-freshness.ts`.** The gate reads the stamped freshness on the stored map
statically and never resolves evidence at gate time. It is inert unless the `site_map` capability
is on.

**`gates/visual-evidence.ts` and `repository/bundle-completeness-gate.ts`.** Both are evidence
gate functions, not `Gate` classes, because the class result shape has no `skipped` or
`inconclusive`. Each reads files with one read and compares against the buffer, never
stat-then-read, which is the race CodeQL flags. Both can only hard-fail at local origins: the
bundle is git-ignored, so a fresh CI checkout has none. Attached screenshots are named as
attached, never passed off as scripted. A frozen spec names each criterion `criterion_id`; `id` is
a fallback only.

**`repository/bundle-completeness-config.ts`.** This builder lives in its own file so the
completeness gate and the HUD snapshot share it without loading the whole verification run.
Stage isolation is a property of the change (its recorded lane and host adapter) and of the
`stage_isolation_lanes` list (default `full`, `full` always included), resolved once per check
through `layeredConfigMap`. `isolationStatusFrom` takes that list from its caller: a lane in it is
`expected`, any other lane is `not-applicable`, so a graduated change runs inline by default
(`graduated,full` restores the old behaviour). A host that cannot dispatch subagents is never asked
for isolation; a null lane is `unresolved`, which surfaces as Inconclusive and never as a block.
After a forward-only raise (`lane_raised` on `feature.json`) the status stays `not-applicable`
until a stage starts at or after `lane_raised.at`; from then on it is `expected` and the builder
passes `stageIsolationSince`, so the gate asks only for `stage-agent` rows recorded after the
raise and never fails earlier inline stages. The HUD reads the same `stageIsolationStatus`. After a raise its
`isolation-missing` flag still counts `stage-agent` rows from before the raise, while the gate counts
only those after it, so the HUD can show no flag while the gate fails (tracked as tech debt
TD-01M64HFSW101H0E24VD68X4PZA). The spec-pipeline flags are
read through `layeredConfigMap`, not `src/spec-pipeline`, because `src/verification` must not
import the pipeline; unset flags take the pipeline's own defaults through the same resolver. A
change whose spec was frozen before the pipeline default turned on is not asked for pipeline files.

**`repository/bundle-completeness-gate.ts`.** It took over the cache backfill of the older
evidence-existence gate as a recovery step: a recoverable file is minted from the engine caches
but reported `backfilled`, never a clean pass, so the recorder defect stays visible. RAG cannot be
reconstructed, so a RAG gap is Inconclusive. A `feature.json` with the placeholder title and no
ticket counts as missing. Content hashes are checked only on files that carry the envelope header,
because a hook cannot see a Bash write into the bundle; derived files (`report.html`, the
receipt, the AI-BOM) keep their header where this check never reads it. A pipeline file owed only
because the lane was raised after a fast-lane freeze cannot be written on its own, so the message
says to re-freeze the spec.

**Mode files (`bundle-completeness-mode.ts`, `evidence-existence-mode.ts`, `visual-evidence-mode.ts`).**
Each mode is floored: the team-tracked `configs/.config.*` value is the floor, and the local
`.config` or the environment variable may only raise it, so a lone developer cannot weaken a
check the team committed. Bundle completeness defaults to `strict`; evidence existence has no
`strict` tier on purpose, because this class of completion check has a history of false blocks;
visual evidence defaults to `warn`.

**`repository/judgment-inputs.ts`.** Each function is pure over an already loaded artifact, so the
judgment is deterministic and unit-testable; `repository-context.ts` does the loading. A signal
that needs model judgment, or whose proving artifact is missing, returns `inconclusive` with
`passed: true`, so it escalates without blocking a clean change that predates a frozen spec.

**`repository/receipt.ts`.** The list of not-done stages and the per-stage block are computed from
the same `stageStatus` and `applyChecksHonesty`, so a headline naming those stages can never
disagree with the block. An unknown `checksVerified` leaves the `checks` line as it was, so callers
that do not compute it keep the old rendering. A plan compiled before the reuse gate gets no reuse
suffix, so the receipt never implies a check that did not happen.

**`repository/repository-context.ts`.** At the in-session completion origin, files that were
already dirty when the session started and are unchanged since are subtracted, so a pre-existing
edit is not blamed on a read-only turn; commit, push and CI origins stay path based. Every `.paqad/`
home, including a nested `runtime/base/.paqad/`, is removed from the changed-file scan, since
generated framework files are never implementation. The change map is built from the branch's
changed files, not the session's, because a proving test committed earlier on the branch still
counts. Its build failure is logged to `.paqad/logs/hooks.log`, never stderr, because on the Stop
path stderr is shown to the user. A change map left by an earlier change is ignored. Tests, docs
and the framework's own folders are always in scope, and no boundary is invented when no frozen
spec backs the map.

**`repository/run-repository-verification.ts`.** The backstop omits the pure model-judgment gates
(they read `skipped`). The specific computed gates run before the change-completeness roll-up,
because the runner stops at the first failure and that gate is the one the developer reads. The
duplication gate sits after the quality gates since a near-copy is a quality signal. When paqad is
disabled the backstop writes nothing and returns an `ok` verdict. The ownership skip runs after
the enabled check and before the context build, so a skipped session produces no context, gate,
record, file or block. The duplication report and module-health sync run here because this is the
one completion seam that runs in every consumer repo; both are best effort and never change the
verdict. The live host session id is passed to stage-evidence finalization so the completion seam
writes under the same session as the prompt seam. Gates pushed straight onto the evidence (not
through the runner) are counted by the bundle receipt too. A passing change is closed last, after
every writer has used it; a change the completeness gate failed stays open so the next turn
re-verifies it. The narration audit ignores stages a hook inferred, since the agent never claimed
them. The stage-evidence gate is decided by the presence of a change record, not the working-tree
diff count, so a committed but incomplete change still fails; the diff-count argument is kept only
for call-site stability. An ordering failure names its `before -> after` pairs instead of an empty
missing list.

**`repository/scope-drift.ts`.** Trailing slashes are trimmed with a character scan, not a
`/\/+$/` regex, which CodeQL flags as polynomial ReDoS.

**`change-metrics/`.** The two change-shape numbers are folds over caches the completion gates
already built (the duplication report and the code-knowledge index), so nothing scans the tree a
second time. Each reads `n/a` when its cache is missing or the change has no meaningful lines,
never a misleading 0. Duplicated lines are unioned per file before counting, because findings can
overlap. A meaningful line is non-blank and does not start with a common comment marker; the test
is kept simple on purpose, and counting a comment as code would only make the ratios more
conservative. A line with code and a trailing comment still counts. An unreadable file adds zero
rather than throwing. The trend read drops the ledger's `open` marker row before taking the last
rows.

**The duplication detector (`src/duplication/`).** One scan function serves both the
`duplication scan` verb (which the armed rule script shells out to) and in-process callers, and
caches its report where the Stop gate reads it, so both see one result. Precision comes before
recall because the gate can block:

- *New code only.* A candidate must overlap a line range the change added or modified. Nothing else
  parses diff hunks, so `hunks.ts` reads `git diff --unified=0 HEAD` with a pure parser (fixture
  tested, no git process); a pure deletion adds no range, and an untracked file counts as all new so
  a brand-new copy is caught. Every chunk from a changed file is left out of the corpus, which
  removes both self-matches and a moved function matching its own removed original.
- *Cheap first.* Short snippets below the minimum line count never score, and a size-ratio check
  skips corpus chunks whose size is too different before the costly comparison.
- *Scoring.* Normalised token-shingle Jaccard over the chunk text, which costs no model tokens and
  works with or without an embedding index. Comments and string contents are dropped and whitespace
  collapsed, so a copy with light edits still matches; tokens are joined with a newline so two
  different splits never form the same shingle, and a stream shorter than the shingle size becomes
  one shingle instead of scoring 0. The repo's other `jaccard` and `tokenize` helpers are private
  and shaped for other uses, so this module keeps its own.
- *Corpus.* Chunks come from the token-efficiency chunk index, else the embedding index; with neither
  the detector reports nothing rather than failing. Chunks carry no line numbers, so a chunk is found
  verbatim in its file to get a range, and a chunk that cannot be found is skipped, never given a
  wrong range.
- *Config.* `duplication_mode` is floored like the other capability modes and ships as `warn` so
  findings are seen for a while before strict blocking is turned on. The numeric knobs are ordinary
  local-wins values, and a bad value falls back to the default.
- *Escape hatch.* A blocking finding can be accepted through a `create-vs-reuse` decision. The packet
  shape has no evidence field, so the evidence and a stable machine token ride in its `context`, and
  one builder writes that token so the writer and reader cannot drift. A resolved packet downgrades
  its finding to the review band. A scan also offers that pause itself for its strongest finding,
  and a scan never fails because the pause could not be opened.
- *jscpd.* When it is on the PATH it runs over the changed files only and marks matching findings as
  corroborated; it reuses the codebase-health jscpd parser. Its report is read whatever its exit
  code, since it can exit non-zero and still write one. Without it nothing changes.
- The run's counts go to the active feature's `duplication.jsonl` so the strict-mode decision rests
  on real data; the finding message is built by one function so the rule script, gate and fixtures
  print the same text.

### `runtime/scripts/verify-backstop.mjs`

- It is the provider-independent backstop run by the generated git pre-commit and pre-push hooks
  and the CI step, the layers an agent cannot skip with `--no-verify`. `--soft-fail` turns infra
  errors (missing build, failed import) into exit 0 for the in-session completion hook only; CI
  never uses it. The built entry is resolved two levels up from the module URL, so it works
  installed globally, as a dependency, or in this repo.
- When paqad is disabled, or the package is uninstalled so the off signal cannot be confirmed, it
  runs no gate. A real completion while disabled still records one disabled-session audit row, so
  the bypass shows in the dashboard and SIEM; that write is lazy and skipped when there is no dist.
- Only a hard failure (a gate reported `fail`) blocks. Inconclusive is surfaced but never blocks.
  A verdict with no gates array falls back to `!verdict.ok` so a real failure never slips through.
- On the Stop hook, blocking rides the documented `{decision: "block"}` field, because exit 2
  does not block a Stop hook. No `systemMessage` is emitted, since Claude Code renders it as
  "Stop says:" lines; the block reason reaches the model only, and the agent's final message is the
  developer-facing channel. The receipt paqad computed is written every turn so the HUD shows it
  rather than the model's retelling; a failed write is logged and changes nothing. When the loop
  guard is active the gate already bit once, so it steps aside.
- For git and CI the exit code is the gate, so it prints plain text and a hard fail exits 2.

## Feature Pages

- [Mutation Testing — Verification Gate](../mutation-testing.md) — plant mutants in
  the changed code and confirm the tests catch every behaviour-changing one.
  Off by default; runs on CI and pre-push only when the project opts in.
- [Flaky-Test Handling — Trust in a Pass](../flaky-handling.md) — own the
  test-trust signal so a green run means green.
- [Deterministic Check Runner](../check-runner.md) — run the mapped
  format/test/build commands and feed real structured results to `code-tests-lint`,
  so the completion verdict proves the checks ran instead of assuming they did. A green
  build and test run is reused on an identical tree, and a report for different files
  reads Inconclusive.
- [Review Evidence Digest](../review-digest.md) — hand the review stage the facts
  paqad already computed, and make an unaddressed deterministic finding a review
  failure rather than a silent omission.

## Source Footprint

- `src/verification/gate-runner.ts` — runs the bank, aggregates verdicts.
- `src/verification/delta.ts` — computes the change versus the last run.
- `src/verification/gates/**` — the individual gates (and `gate.interface.ts` /
  `shared.ts` infra).
- `src/verification/evidence.ts`, `evidence-markdown.ts` — structured + Markdown
  evidence emission (also rendered by the `evidence` CLI command).
- `src/verification/repository/**` — the repository-facing inputs the gates read.
- `src/checks/run-checks.ts`, `src/checks/report-store.ts`, `src/cli/commands/checks.ts`
  — the deterministic check runner (`paqad-ai checks run`) that produces the
  structured test/build/format results `code-tests-lint` consumes.
- `src/review-digest/**`, `src/cli/commands/review.ts` — the review evidence digest
  (`paqad-ai review digest`): one collector unions the four cached finding sources,
  a pure composer renders the digest, and `implementation-review` re-derives the
  same rows to check the review addressed them.

## Boundaries

This module **owns** the verdict and the evidence row for each gate. It does
**not** own the ledger or the receipt (that is `evidence-ledger`), the SIEM
projection (`cli-audit`), or the quality baseline itself (`quality-ratchet`) — it
consumes the ratchet's output and emits a verdict. It decides; other modules
record and project.

## Authority

The single source of truth for this module's identity, slug, feature names, and
source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins** — update the map first,
then regenerate this page via `create module documentation`.

## Related

- Evidence ledger + provenance receipt: [`evidence-ledger`](../../evidence-ledger/index/summary.md)
- Quality ratchet (a gate input): [`quality-ratchet`](../../quality-ratchet/index/summary.md)
- Bidirectional traceability: [`traceability-engine`](../../traceability-engine/index/summary.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)

