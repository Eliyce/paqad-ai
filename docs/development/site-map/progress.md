# Site Map Rebuild: progress

**Read this file first, before `plan.md`.** It says where the work stands and what to do next.
Update it after every commit. It is the handover between sessions.

---

## State of play

| | |
| --- | --- |
| **Branch** | `feat/site-map-rebuild` (created from `origin/main`) |
| **PR** | [#509](https://github.com/Eliyce/paqad-ai/pull/509) (open) |
| **Base** | `origin/main` at `35fdf431` when the plan was written; branch cut from `f56eedaf` |
| **Tasks done** | 6 of 10 |
| **Currently in flight** | nothing |
| **Next action** | Start **S7** (full-screen map and a readable zoom floor). No dependency. See `plan.md` §6 S7: a `Full screen` button + `f`/`Escape`, hide all four chrome pieces together, Fullscreen API with a CSS fallback, raise `minZoom` 0.05 → 0.25, an over-size hint at the floor, respect `prefers-reduced-motion`, and never persist the full-screen preference. |
| **Blocked on** | **DEC-1** blocks S3 only. See `plan.md` §5. Raise the decision packet early so it is answered by the time S3 comes up. |
| **Last updated** | 2026-08-31, session 7: S6 landed |

---

## Task tracker

Status is one of: `todo`, `in progress`, `done`, `blocked`, `skipped`.

| Task | What it does | Fixes | Size | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| **S1** | Recompile the rulebook when it goes stale | D1 | S | `done` | `3c2949a7` |
| **S2** | Honest verdict when the map is absent or link-less | D4 | S | `done` | `255d4287` |
| **S3a** | Preflight: requirement contract and registry | D5 D6 | M | `blocked` (DEC-1) | |
| **S3b** | Preflight: site-map requirements and the tray | D5 D6 | M | `blocked` (DEC-1) | |
| **S3c** | Preflight: persist answers into the answer store | D6 | M | `blocked` (DEC-1) | |
| **S4** | Report the surface inventory before any write | D7 | S | `done` | `d29896b1` |
| **S5a** | Progress store with crash recovery | D7 | M | `done` | `e5583cde` |
| **S5b** | `sitemap status` reads the progress file | D7 | S | `done` | `bfdb57ac` |
| **S6** | Show run progress in the dashboard | D8 | S | `done` | `8d57e5f4` |
| **S7** | Full-screen map and a readable zoom floor | D8 | S | `todo` | |
| **S8a** | Draft the map skeleton from the extraction | D2 | L | `todo` | |
| **S8b** | Draft resumes from the progress file | D2 D7 | L | `todo` | |
| **S8c** | Unhide the `sitemap` command | D2 | S | `todo` | |
| **S9a** | Transition detectors | D3 | L | `todo` | |
| **S9b** | Resolve transition targets to surfaces | D3 | L | `todo` | |
| **S9c** | Reconcile missing links as findings | D3 | L | `todo` | |
| **S10** | Rewrite the workflow rule | D1 | S | `todo` | |

**Dependency reminders.** S5 needs S4. S6 needs S5. S8 needs S4 and S5. S9 needs S8.
S10 needs S3, S5, S8 and S9. S1, S2, S4, S7 have no dependencies and can go any time.

---

## Defects being closed

Tick a defect only when every task that fixes it is done.

- [ ] **D1** Stale rulebook served to the agent, describing the wrong folder and claiming the verb writes the map. `S1`, `S10`
- [ ] **D2** Nothing writes the map; the AI hand-types it; the command is hidden. `S8a`, `S8b`, `S8c`
- [ ] **D3** Nothing detects links; 0 transitions in a 112-surface map. `S9a`, `S9b`, `S9c`
- [x] **D4** An absent or link-less map reads "Safe to merge". `S2`
- [ ] **D5** A command that cannot run asks nothing and degrades silently. `S3a`, `S3b`
- [ ] **D6** The question tray fires last and can ask four things. `S3b`, `S3c`
- [ ] **D7** Every session starts from zero. `S4`, `S5a`, `S5b`, `S8b` (S8b still open)
- [ ] **D8** No full screen anywhere; no run progress shown. `S6` (done), `S7` (S7 still open)

---

## Decisions

| id | Question | Status | Answer | Packet |
| --- | --- | --- | --- | --- |
| **DEC-1** | When the site map needs the output of a project command (for example `php artisan route:list`), does paqad run it, or print it and wait for pasted output? | **open** | recommendation on record: run it, read-only commands only, with print-and-paste kept as a tray option | not yet created |

Create the packet with `paqad-ai decision create` (never by hand), surface it with
`AskUserQuestion`, resolve it with `paqad-ai decision resolve`, and commit the resolved file
with the S3 commits.

---

## Session log

One entry per session. Newest at the top. Keep entries short and factual.

### 2026-08-31, session 7: S6

- **S6 done** (`8d57e5f4`): the Site map dashboard area now shows how far a run has got.
  - **Server:** new static `GET /api/site-map/progress` (`src/dashboard/server.ts`) returns the
    S5 progress file through `readProgress` (tolerant, write-free), or `null` when none — safe to
    poll while a run is in flight.
  - **Ops job:** the `site-map` executor (`src/dashboard/ops-jobs.ts`) now reads the progress
    store after the audit and emits one plain-language line per completed unit, via a new pure
    `describeCompletedUnits(progress)` in `src/site-map/progress-store.ts` that words each `done`
    unit as `<Kind> <ordinal> of <total-of-kind>: <label>` (e.g. `Journey 8 of 12: Checkout,
    guest`), ordinal/total per kind in declaration order. The S4 inventory sentence still leads
    and the `Mapped the app:` summary still trails; with no store it emits none.
  - **graph-ui:** a new pure `graph-ui/src/lib/site-map-progress.ts` mirrors the progress shape
    and projects it to the strip fields via `summarizeSiteMapProgress` (null when the file is null
    or unit-less); `fetchSiteMapProgress` added to `api.ts`. `SiteMapView` reuses the existing
    `OpButton action="site-map"` (SSE + poll backstop, `onDone` reloads) and renders a
    `ProgressStrip` (current unit · done/writing/remaining · a "finished earlier" line) only when a
    progress file exists — nothing rendered otherwise (AC-4/AC-5).
  - Tests: `describeCompletedUnits` (per-kind wording, nothing-done, empty) and
    `summarizeSiteMapProgress` (populated, null, empty, singular/plural skipped, writing→next→
    all-mapped precedence); ops-jobs (worded per-unit lines from a seeded store, existing no-store
    test still green); server route (file present → returns it, absent → null). `pnpm run ci`
    green (typecheck/lint/format/coverage/graph-ui/build); `paqad-ai checks run` green. No
    dependency added, no new state library, no change to existing routes/exit codes/data shapes.
- **Plan seam recorded (AC-2).** AC-2 ("one `progress()` per completed unit") describes authoring
  progress, but the `site-map` ops action runs the verification audit (`runSiteMapAudit`), which
  authors **no** units — unit authoring is **S8** (`sitemap draft`). S6 implements AC-2 honestly:
  the job reports the store's already-`done` units (resumable state), which is forward-compatible —
  once S8 populates the store live, the same emission reflects live authoring. See "Found on the
  way".
- D8 stays open: S6 (run progress) is done; `S7` (full screen + readable zoom floor) still remains
  before D8 can be ticked.

### 2026-08-31, session 6: S5b

- **S5b done** (`bfdb57ac`): the read-only `paqad-ai sitemap status` verb. A new pure
  `summarizeProgress(progress) -> { total, done, writing, failed, remaining, next }`
  (`src/site-map/progress-store.ts`, with `SiteMapProgressSummary` in
  `src/core/types/site-map-progress.ts`) counts units by state — `remaining` is the
  `not_started` count so `total = done + writing + failed + remaining` — and picks the first
  `not_started` unit in declaration order as `next` (null when none remain). The `status` verb
  (`src/cli/commands/sitemap.ts`) reads through `readProgress` only, prints a human counts line +
  next-unit line + a JSON line, and with no file prints the from-the-beginning line +
  `{"status":"none"}`. It always exits `0` and performs no writes (no crash-recovery reset), so it
  is safe while a run is in flight. Tests: `summarizeProgress` directly (mixed states, all-done →
  next null, first-of-two not_started, empty); CLI (registered, populated, absent, and a
  `writing`-only file asserting `saveProgress`/`recoverInFlight` are never called). `pnpm run ci`
  green (exit 0); `paqad-ai checks run` green (format/test/build). Smoke-tested in this repo: no
  progress file → the from-the-beginning line + `{"status":"none"}`, exit 0; `sitemap --help`
  lists the verb.
- **Spec-driven divergence recorded.** Unlike the sibling verbs, `status` has no
  try/catch → exit 2: `readProgress` is tolerant (never throws) and `summarizeProgress` is pure, so
  a catch branch would be unreachable and break the 95% branch floor; AC-3 mandates always-`0`
  anyway. Documented at the call site and in the plan decisions.
- D7 stays open: S5b (status readout) is done, but `S8b` (draft resumes from the progress file)
  still remains before D7 can be ticked.

### 2026-08-31, session 5: S5a

- **S5a done** (`e5583cde`): the resumable progress store. New persisted shape
  `SiteMapProgressFile` / `SiteMapProgressUnit` (`src/core/types/site-map-progress.ts`) with a
  registered JSON schema (`src/validators/schemas/site-map-progress.schema.json`), a new
  `PATHS.SITE_MAP_PROGRESS` (`.paqad/site-map/progress.json`), and a functional
  `src/site-map/progress-store.ts`: tolerant `readProgress` (missing/corrupt/schema-invalid →
  `null`, never throws), atomic `saveProgress` (writes through `writeJsonFile` to a unique temp
  path + rename, stamps `updated_at`), `recoverInFlight` crash recovery (every `writing` unit →
  `not_started`, `started_at`/`error` cleared, its `artifact` file **deleted**), and
  `reconcileDoneUnits` skip rule (a `done` unit whose `source_hash` still matches is skipped; a
  changed hash resets it), plus the `createEmptyProgress`/`createUnit`/`startUnit`/
  `completeUnit`/`failUnit` mutators. Reuses `hashSourceFiles` (`src/document/staleness.ts`) for
  staleness. This is the store only; the `sitemap status` verb is S5b. Tests: every state
  transition, the reset-and-delete on load (artifact asserted gone), hash-match skip, hash-change
  reset, corrupt and schema-invalid reads → empty, and two concurrent writes not interleaving.
  Store file at 100% coverage; `pnpm run ci` green (8325 tests, 95.36% branches). No CLI or
  dashboard touched; no dependency added; no API/exit-code change.
- **Plan gap resolved (AC-3).** The plan says "atomic write: temp file plus rename" *and* "reuse
  `writeJsonFile`", but `writeJsonFile` is a plain `mkdir`+`writeFile` (not atomic). Recorded
  reading, honoured in code and in the plan's decisions: `saveProgress` writes the JSON through
  `writeJsonFile` to a **unique** temp path (pid + a monotonic counter) and then `rename`s it onto
  the target — satisfying both clauses and the "two writes do not interleave" criterion.
- D7 stays open: S5a is the store; `S5b` (status readout) and `S8b` (draft resumes from it) still
  remain before D7 can be ticked.

### 2026-08-31, session 4: S4

- **S4 done** (`d29896b1`): a run now says how big the job is before any write. Added a pure
  `deriveSiteMapInventory(extraction) -> { screens, groups, guards }` and a shared
  `describeSiteMapInventory` sentence in `run.ts`; `SiteMapRunResult` carries an `inventory` block
  and `runSiteMapAudit` gained an optional `onInventory` callback fired once after gather. New
  read-only `paqad-ai sitemap inventory` verb (gathers via `gatherSiteMapReport`, prints the
  sentence + a JSON line, `--quiet` suppresses the JSON, no writes). The dashboard `site-map` ops
  job now reports the inventory as its first progress line, replacing the generic "Mapping the app"
  sentence. No journey count (AC-4). Tests: inventory helper (modules/guards + empty), the CLI verb
  (read-only, JSON shape, `--quiet`, error path), and the ops first-progress sentence. `pnpm run ci`
  green (8315 + 13 tests, coverage floors met). Exit codes and the verdict are unchanged.
- **`guards` semantics (plan gap resolved).** The plan fixes `inventory.guards: number` but only
  defines `groups`. Recorded reading: `guards` is the count of **distinct guard tokens** across the
  extracted surfaces — the numeric parallel of `groups` (distinct modules). Documented on the type,
  in the spec, and tested directly.
- D7 stays open: S4 is the inventory the resumable store (S5) will tick off; `S5a`, `S5b`, `S8b`
  still remain.

### 2026-08-31, session 3: S2

- **S2 done** (`255d4287`): `collectVerificationFindings` now records a `map-present` blocked
  check when there is no stored map, and `detectGraphInvariants` records a `reachability`
  blocked check when a map records zero transitions (the checks still short-circuit; the skip
  is just visible now). `SiteMapRunResult` gains `verdict: 'safe' | 'attention' | 'inconclusive'`
  via a pure `deriveSiteMapVerdict`; the CLI prints it in the contract words and adds it to the
  JSON line. Exit codes are unchanged. The 8 stale `docs/instructions/site-map/app-map.yaml`
  resolution strings now point at `PATHS.SITE_MAP_CANONICAL_APP_MAP`. Tests: rewrote the no-map
  and zero-transition verification tests, updated the two run tests whose null-map path now
  carries `map-present`, and added four verdict-scenario run tests plus a five-branch unit test
  of `deriveSiteMapVerdict` and a CLI Inconclusive test. `pnpm run ci` green.
- Note on the DoD line: `sitemap run` in this repo now reports **Needs your attention**, not
  Inconclusive. The plan's snapshot (112 surfaces, 0 transitions) is stale — the live map has
  since gained transitions and carries 4 real findings, so `attention` (findings outrank the
  inconclusive reasons, AC-3) is the honest verdict. The D4 fix itself is proven by the unit
  tests: a zero-findings absent/link-less map now reads `inconclusive`, never `safe`.

### 2026-08-31, session 2: S1

- Created `feat/site-map-rebuild` from `origin/main` (`f56eedaf`). Opened PR #509.
- Added the whole-rebuild `minor` changeset (`.changeset/site-map-rebuild.md`); `npx changeset status` clean.
- **S1 done** (`3c2949a7`): `refreshRuleContext` recompiles a stale compiled rule store inside the
  single-flight lock before it is read, gated on the rule-loading path, guarded against an absent
  rules tree, fail-tolerant. New doctor check `Compiled rules are current` fails when stale. Four
  new tests (fresh-text recompile, current-store-no-recompile via spy, failing-recompile-no-throw,
  loadRules-false-skip) plus two health-check tests. `pnpm run ci` green (8297 tests).
- Verified the premise: the on-disk `docs/instructions/rules/coding/site-map.md` already names
  `docs/site-map/` (6×, zero `docs/instructions/site-map/`), and the live store is dated
  2026-07-29, so S1's recompile serves the correct folder. The instruction rewrite is S10.
- A framework `spec.change` pause armed because the S1 spec was frozen, then restructured
  (FR-/INV-/AC- sections so behaviour parses) and re-frozen. Surfaced via `AskUserQuestion`,
  resolved `update-and-refreeze`, resolved packet committed with S1.

### 2026-08-31, session 1: research and planning

- Researched the whole site-map workflow. Eight defects verified against the code, D1 to D8,
  recorded in `plan.md` §2 with file and line proof.
- Wrote `plan.md`, this file, and `prompt.md`.
- No code written. No branch created.
- Published the visual summary as an artifact for review, which was approved.

---

## Found on the way

Real problems noticed while implementing that are **out of scope** for this PR. Write them
here rather than fixing them, so the PR stays reviewable. A human triages them later.

- `src/site-map/verification.ts` joins evidence keys with a NUL character (`\u0000`) as the
  separator. That is deliberate and correct, but it makes some grep tools treat the file as
  binary, which is confusing when searching. Worth a comment, not a change.
- `doctor` measures the size of `session-context.md` but never its freshness. S1 adds a
  freshness check; the size check stays as it is.
- A paqad session process flips the exec bit on `runtime/hooks/lib/agent-entry-directive.mjs`
  (`100644` → `100755`) mid-session on macOS. It is not a source change and was kept out of the
  S1 commit; worth checking whether the on-disk hook file should just ship with the exec bit set.
- **The dashboard `site-map` ops action still runs the verification audit, not the draft.** So the
  S6 per-unit progress lines report the units a previous `sitemap draft` (S8) finished, not live
  authoring. Once S8 lands and the ops action drives (or is followed by) `draft`, the same
  `describeCompletedUnits` emission and the `GET /api/site-map/progress` strip will reflect a live
  authoring run with no further wiring. This is the S6→S8 seam the plan's task order creates; it is
  not a defect.

---

## How to update this file

After each commit:

1. Set the task's status to `done` and paste the short commit hash.
2. If a defect is now fully closed, tick it.
3. Rewrite **State of play**: tasks done, what is in flight, and the single next action.
4. Add a line to the session log if the session is ending.
5. Move anything out of scope into **Found on the way**.

Be accurate. If a task is partly done, say `in progress` and write exactly what remains in
the next-action line. Never mark something `done` that is not.
