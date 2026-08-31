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
| **Tasks done** | 2 of 10 |
| **Currently in flight** | nothing |
| **Next action** | Start **S4** (report the surface inventory before any write). No dependency, DEC-1 not needed. |
| **Blocked on** | **DEC-1** blocks S3 only. See `plan.md` §5. Raise the decision packet early so it is answered by the time S3 comes up. |
| **Last updated** | 2026-08-31, session 3: S2 landed |

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
| **S4** | Report the surface inventory before any write | D7 | S | `todo` | |
| **S5a** | Progress store with crash recovery | D7 | M | `todo` | |
| **S5b** | `sitemap status` reads the progress file | D7 | S | `todo` | |
| **S6** | Show run progress in the dashboard | D8 | S | `todo` | |
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
- [ ] **D7** Every session starts from zero. `S4`, `S5a`, `S5b`, `S8b`
- [ ] **D8** No full screen anywhere; no run progress shown. `S6`, `S7`

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
