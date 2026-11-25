# Local status, resume and housekeeping: requirements (v1.0)

**Status:** v1.0, 25 November 2026. Requirements only: nothing here is built yet. Progress lives in [`PROGRESS.md`](PROGRESS.md); the prompt that builds the next slice is [`prompts/build-next.md`](prompts/build-next.md).
**Owner:** Haider.
**Scope:** six small features that run on the developer's machine. Each writes only git-ignored files under `.paqad/` (apart from this documentation), makes no network call and needs no hosted service.

**How to read this:** MUST is required. SHOULD is a default that can change with a recorded reason. MAY is optional. Requirement IDs are for building and testing; users never see them. **Fact** means checked in this repository on 25 November 2026, with the file named. Anything not yet proven is listed in section 9 and stays unknown until slice S0 proves it.

---

## 1. Why this work

paqad already records a lot while it works: a HUD snapshot per session, a heartbeat, and an evidence bundle per change. Four gaps make that record less useful than it should be:

1. **Other tools cannot rely on it.** A status line, an editor panel or another plugin can read the files today, but nothing says which files are stable, what shape they have, or when the shape changes. A reader that guesses breaks silently on the next release.
2. **A crashed session looks alive.** The heartbeat is judged by file age alone, with a 120-second window, and it is written only while the band is shown.
3. **A usage limit wastes the lane.** When the model provider's usage limit stops a long lane, the work in flight has no checkpoint, and nothing continues it.
4. **Local state grows without end.** Session files and evidence bundles are never pruned.

Two smaller needs ride along: an honest estimate before a full lane starts, and a release that can list the plugin in another marketplace without breaking existing installs.

## 2. Where things stand (facts)

| Area | Today | Source |
| --- | --- | --- |
| HUD snapshot | Written to `.paqad/session/hud/<session>.json` with `schema: "paqad.hud/3"` each time a HUD refresh verb runs, whatever the band setting. Its shape lives only in TypeScript (`HudSnapshot`); there is no JSON Schema file. | `src/hud/snapshot.ts` (`HUD_SNAPSHOT_SCHEMA`, `writeHudSnapshot`), `src/hud/refresh.ts`, `src/core/constants/paths.ts` (`HUD_DIR`) |
| Heartbeat | `.paqad/session/hud/<session>.live` holds `{session_id, written_at}` and is written by the plugin band every 60 s. A session counts as attached while the file is under 120 s old. The band starts its timer only when it is on, so `hud.band: false` also stops the heartbeat. | `runtime/claude-plugin/mod/register.tsx` (`HEARTBEAT_MS`, `beat`; `bind` runs only when the status is on), `src/health/hud-attachment.ts` (`HEARTBEAT_WINDOW_MS`) |
| Evidence bundle | One folder per change under `.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/`. Every JSON document opens with `schema_version`, `doc_type`, `change`, `session_id`, `recorded_at` and `content_hash`, and is checked by strict in-code schemas with ids such as `paqad://schemas/feature.json`. | `docs/modules/feature-evidence/index/summary.md`, `src/feature-evidence/schema.ts` |
| What git ignores | `session/` and `ledger/` are in paqad's managed block of `.paqad/.gitignore`. | `.paqad/.gitignore` |
| Band switch | `hud.band` in `.paqad/configs/paqad.yaml` hides the band (also `hud_view` in `.paqad/.config` or `PAQAD_HUD_VIEW`). It is on by default. | `src/core/framework-config.ts` (`hud_view`), `runtime/claude-plugin/mod/config.ts` (`isHudViewOff`) |
| Team settings | `.paqad/configs/git-workflow/branches.yaml`, `tickets.yaml`, `commits.yaml`, `pull-requests.yaml`, `enforcement.yaml` and `design-sign-off.yaml` are committed, and each carries `schema_version: 1`. | `.paqad/configs/git-workflow/`, `.paqad/configs/README.md` |
| Resume | `paqad-ai resume --feature <ref>` reactivates a paused change. Nothing detects a usage limit, and nothing checkpoints work in flight. | `src/cli/commands/resume.ts`; no usage-limit handling found in `src/` |
| Time and cost history | Each bundle keeps `cost.json` (tokens and money) and `stage-evidence.jsonl` (stage times); `paqad-ai report speed` already reads both. Nothing estimates a lane before it starts. | `docs/modules/feature-evidence/features/speed-report/`, `src/cost/` |
| Pruning | No code removes old session files or bundles. One real project after several weeks of use held 88 session files (4.8 MB) and a 55 MB ledger. | `src/hud/`, `src/session/`; measured 25 November 2026 |
| Marketplace | The release pushes the assembled plugin to one repo, which is also the `eliyce` marketplace. Install code, the project hook and the README name that repo. | `.github/workflows/release.yml`, `scripts/assemble-plugin.mjs`, `src/install/plugin-settings-keys.ts` (`PLUGIN_MARKETPLACE_REPO`), `.paqad/hook.mjs` (`PLUGIN_REPO_URL`) |

## 3. Decisions made

Do not reopen these without a material reason.

- **DEC-1.** Everything here is local: no hosted schema address, no network call, no service.
- **DEC-2.** The contract for other readers is the files paqad already writes, plus a JSON Schema and conformance samples kept in this repo and shipped in the npm package. No new summary file and no reader library.
- **DEC-3.** The read files stay git-ignored. A team shares only config and rulings.
- **DEC-4.** A breaking change to a read file bumps its major and says so in the changelog. Adding an optional field does not.
- **DEC-5.** Checkpoints are local git refs. They are never pushed and never land on a branch.
- **DEC-6.** The estimate informs; it never blocks a lane.
- **DEC-7.** Housekeeping touches only git-ignored files under `.paqad/` and never an open change.
- **DEC-8.** Hiding the band (`hud.band: false`) hides only the band. paqad keeps writing its snapshot, heartbeat and evidence.

## 4. What success looks like

- **SUC-1.** A status line written by someone else shows the current stage of a running lane from the files alone, without importing paqad code, and keeps working across paqad minor releases.
- **SUC-2.** When a session crashes, every reader on the same machine sees it as gone on its next check, and any other reader within one heartbeat window.
- **SUC-3.** A lane stopped by a usage limit continues from its last finished stage with no finished work lost, and nobody else ever sees a checkpoint.
- **SUC-4.** Before a full lane starts, the person sees an honest range for time and cost and how many past changes it rests on; after the change, the actual figures sit next to it.
- **SUC-5.** `.paqad/session/` and `.paqad/ledger/` stay within the configured limits without anyone thinking about it.
- **SUC-6.** Existing installs keep working through a marketplace change.

## 5. Requirements

### 5.1 Read surface (RS)

**Goal.** Any local tool can read what paqad is doing, safely, without depending on paqad's code.
**Value to the user.** People build their own status lines, editor panels and dashboards on top of paqad, and those keep working after an update.
**Why.** The files already exist and are already checked in code; only the published contract is missing. Publishing it costs a few schema files and a test.
**How it makes paqad solid.** paqad's internals can keep changing while the outside contract stays still, and paqad's own CI catches a breaking change before any reader meets it.

- **RS-1 MUST.** Declare these files a read-only local surface in [`../extension-surface.md`](../extension-surface.md): the HUD snapshot, the heartbeat, the bundle's `feature.json`, `stage-evidence.jsonl` and `cost.json`, and the team settings in CFG-1. Each entry names its path, format id, stability and the version it joined the surface.
- **RS-2 MUST.** Commit one JSON Schema per declared file in this repo, in a folder the npm package ships (proposed: `runtime/schemas/read-surface/`, which `package.json` `files` already includes). Each `$id` uses paqad's existing form, `paqad://schemas/<name>.json`, never a web address.
- **RS-3 MUST.** Generate the bundle schema files from the in-code schemas in `src/feature-evidence/schema.ts`, and the snapshot schema from the `HudSnapshot` type, so the files and the writers cannot drift. CI fails when a generated file is stale.
- **RS-4 MUST.** Ship conformance samples beside each schema, at least one passing and one failing sample per file, and test the writers' real output against the schema.
- **RS-5 MUST.** Every read file carries its format id and major: the snapshot's `schema` (`paqad.hud/3`), the bundle envelope's `doc_type` and `schema_version`, and a new `schema` field in the heartbeat (HB-1).
- **RS-6 MUST.** A breaking change (a field removed, renamed, retyped or given a new meaning) bumps the major and adds a changelog line naming the file and what a reader must change. Adding an optional field keeps the major.
- **RS-7 MUST.** Document the reader rules beside the schemas: ignore unknown fields; treat an unknown major as "status unknown", not as an error; never write to these files; never read a temporary file (paqad replaces files atomically, `src/hud/files.ts`).
- **RS-8 SHOULD.** Export the schema folder from the package (for example `paqad-ai/schemas/*`), so a reader finds a schema without knowing the install path. This changes `package.json` `exports`, so record it in `docs/extension-surface.md` in the same change.
- **RS-9 MUST NOT.** Ship a reader library, a summary file or a hosted copy of the schemas.

**Done when.** The four kinds of file are declared in `docs/extension-surface.md`; their schemas and samples are in the npm tarball (`npm pack --dry-run` lists them); CI fails on a stale generated schema and on writer output that does not match.
**Test approach.** Unit tests validate the samples and the writers' real output; a CI step regenerates the schemas and fails on a diff; a tarball check lists the files.

### 5.2 Heartbeat (HB)

**Goal.** Know within seconds whether a session is still running.
**Value to the user.** A crashed or closed session stops showing as working, in the band, in status lines and in any tool that reads the files.
**Why.** Today a dead session looks alive for up to 120 s (`HEARTBEAT_WINDOW_MS`), and with the band hidden there is no heartbeat at all.
**How it makes paqad solid.** Liveness becomes a checked fact instead of a guess, and it no longer depends on whether the band is on.

- **HB-1 MUST.** The heartbeat keeps its path and adds `schema` (`paqad.heartbeat/1`), `pid` (the coding agent's own process, not a short-lived hook), `boot_id` (the machine's current boot, so a reused process id after a restart is not mistaken for the old one) and `host_id` (a stable local id for the machine), next to `session_id` and `written_at`.
- **HB-2 MUST.** A session is alive only when its heartbeat is younger than the window **and**, on the same machine and boot, its `pid` is a running process. On another machine or boot, only the age counts.
- **HB-3 MUST.** paqad keeps writing the heartbeat while `hud.band: false` hides the band (DEC-8). Proposed approach: when the plugin stands down for `view-off`, it still starts its heartbeat timer and only skips drawing. Settle the approach in the build.
- **HB-4 MUST.** The band and `src/health/hud-attachment.ts` use the HB-2 rule from one shared function.
- **HB-5 MUST.** At session start, paqad removes the heartbeat files of sessions HB-2 judges gone. Other session files are left to housekeeping (HK).
- **HB-6 SHOULD.** Keep the 60 s write and the 120 s window unless S0 shows a different pair is safer at no extra cost.

**Done when.** Killing the agent process makes a same-machine reader report the session gone on its next check; the heartbeat is written while the band is hidden; old heartbeats are swept.
**Test approach.** Unit tests with a fake clock and a fake process table; one integration test that starts and kills a child process and reads the result.

### 5.3 Checkpoints and resume after a usage limit (RES)

**Goal.** A long lane that hits the model provider's usage limit continues later from where it stopped, without losing finished work.
**Value to the user.** People start a full lane and walk away. A usage limit costs waiting time, not rework.
**Why.** A full lane can run for hours. Today a usage limit stops it mid-stage with nothing saved but the files on disk, and the person has to work out what to run again.
**How it makes paqad solid.** Every finished stage becomes a point paqad can return to, which also helps after a crash or a stage that went wrong.

- **RES-1 MUST.** At the end of each stage of a change, paqad records a checkpoint: a commit object of the whole working tree (tracked and untracked files, minus ignored ones), written through a temporary index (`GIT_INDEX_FILE`) so the person's index, branch, stash and history are never touched. A local ref under `refs/paqad/checkpoints/<change ULID>/<stage>` points to it.
- **RES-2 MUST.** Checkpoint refs are never pushed: paqad never adds them to a refspec, and `paqad-ai doctor` warns when a remote holds any `refs/paqad/` ref.
- **RES-3 MUST.** The stage's ledger row records the checkpoint's commit id, so a resume knows which point belongs to which stage.
- **RES-4 MUST.** When a usage limit stops a lane, paqad records the stop (change, stage, time, and the reset time when the host reports it) in the session's snapshot and shows it in the band: what stopped, when it can continue, and the one action that continues it.
- **RES-5 MUST.** Continuing restarts the interrupted stage from the checkpoint of the stage before it, re-reads the frozen spec and plan, and never runs a finished stage again.
- **RES-6 SHOULD.** Continue automatically after the reset time when the host allows it, with a setting to turn that off. Until U-2 is proven, the MUST is a one-step continue: one command or one prompt.
- **RES-7 MUST.** A closed change's checkpoint refs are removed when it closes, and by housekeeping (HK-2) in any case.
- **RES-8 MUST NOT.** Commit, amend, reset, stash or switch branches on the person's behalf to make a checkpoint or to continue.

**Done when.** A lane stopped mid-stage continues from the last finished stage and ends with the same result as an uninterrupted run; the remote never shows a checkpoint; the person's index and stash are byte-identical before and after a checkpoint.
**Test approach.** Integration tests on a temporary repository: checkpoint, simulated stop, continue, compare trees; a test that the index and stash are unchanged; a doctor test against a remote that holds a `refs/paqad/` ref.

### 5.4 Estimate before a full lane (EST)

**Goal.** Before a full lane starts, show how long it will likely take and what it will likely cost.
**Value to the user.** People decide to run, shrink or schedule the work knowing the price, instead of finding out afterwards.
**Why.** Every bundle already holds the real time and cost of past changes (`stage-evidence.jsonl`, `cost.json`), and the speed report reads them after the fact. Reading them before the fact is cheap.
**How it makes paqad solid.** Estimate and actual sit side by side in the record, so the estimate improves with every change and stays honest.

- **EST-1 MUST.** Before a full lane starts its first stage, paqad computes a low-to-high range for wall time, tokens and money, per stage and in total.
- **EST-2 MUST.** The range comes from this project's past bundles on the same lane, weighted by change size when the size is known. With fewer past changes than a minimum (proposed: 5), it uses defaults shipped in the package, and says so.
- **EST-3 MUST.** The estimate states its basis in plain words: "based on N past full-lane changes in this project", or "based on paqad's defaults; no history here yet".
- **EST-4 MUST.** The estimate is written to the change's bundle (a new `estimate.json` with the bundle envelope), and the snapshot gains an optional `estimate` field (additive under RS-6).
- **EST-5 MUST.** After the change, the record shows the estimate next to the actual figures.
- **EST-6 MUST.** `paqad-ai estimate` prints the same estimate for a described change without starting it, with `--json` for machines.
- **EST-7 MUST NOT.** Block, pause or ask a question because of the estimate (DEC-6).
- **EST-8 MUST.** Money uses the same price table as the cost record (`src/cost/prices.ts`), and the estimate never reads transcripts.

**Done when.** A full lane shows a range and its basis before the first stage; the bundle holds `estimate.json`; the record shows the estimate and the actual figures together.
**Test approach.** Unit tests on fixture bundles with no history, a little and plenty; a test that a fresh project gets the shipped defaults; a snapshot test of the plain-words line.

### 5.5 Housekeeping and readable settings (HK, CFG)

**Goal.** Keep paqad's local state small, and let other tools read the team's settings with confidence.
**Value to the user.** Disks and editors stay fast, nobody cleans `.paqad/` by hand, and tools that follow the team's branch and ticket rules read the same files paqad does.
**Why.** Nothing prunes session files or bundles today. The settings files are already versioned but not declared as something others may read.
**How it makes paqad solid.** Bounded local state, predictable cleanup, and one place where the team's git and ticket rules live.

- **HK-1 MUST.** Housekeeping runs at most once a day, at session start, in the background, within a time budget (proposed: 2 s); past the budget it stops and continues next time.
- **HK-2 MUST.** It removes session files (`.paqad/session/hud/*` and the other per-session files) of sessions that are gone (HB-2) and older than `session_keep_days`; bundles of closed changes beyond both `ledger_keep_days` and `ledger_keep_changes`; and checkpoint refs of closed or removed changes.
- **HK-3 MUST.** It never removes a file outside `.paqad/`, a committed file, the bundle of an open or paused change, or anything while a lane runs.
- **HK-4 MUST.** Proposed settings, in `paqad.yaml` under `housekeeping` with the usual `.paqad/.config` and `PAQAD_*` overrides: `enabled` (on), `session_keep_days` (14), `ledger_keep_days` (90) and `ledger_keep_changes` (50, the count the track record already reads, `TRACK_RECORD_BUNDLES` in `src/hud/snapshot.ts`). With the enterprise evidence ledger on (`enterprise_evidence_ledger`), bundle pruning is off unless set.
- **HK-5 MUST.** `paqad-ai prune --dry-run` lists what would go and the space it frees; without `--dry-run` it does the same work now. Every run writes one line to the paqad log with counts and bytes.
- **CFG-1 MUST.** Declare these committed settings in `docs/extension-surface.md` as readable by other tools, read-only, under their existing `schema_version`: `.paqad/configs/git-workflow/branches.yaml`, `tickets.yaml`, `commits.yaml` and `pull-requests.yaml`, and `hud.band` in `.paqad/configs/paqad.yaml`.
- **CFG-2 MUST.** Document `hud.band: false` as the supported way for a project to hide paqad's band, and that it hides only the band (DEC-8).

**Done when.** A project with months of history stays within its limits after one housekeeping run; the dry run lists exactly what the real run removes; the settings are declared.
**Test approach.** Unit tests on fixture `.paqad/` trees with open, paused and closed changes; a test that committed files are never touched; a time-budget test.

### 5.6 Marketplace target (MKT, SHOULD)

**Goal.** The release can list the plugin in a separate marketplace repo while the current repo keeps working.
**Value to the user.** The plugin can sit next to other plugins in one marketplace, and nobody's install breaks.
**Why.** Today one repo is both the plugin and its marketplace, and its name is written into install code, the project hook and the README.
**How it makes paqad solid.** Moving a listing becomes a setting instead of a code change, and existing installs keep resolving.

- **MKT-1 SHOULD.** The release reads an optional marketplace repo from a repository variable and, when set, updates only paqad's own entry in that repo's marketplace file, pointing at the plugin repo at the released tag.
- **MKT-2 MUST (once MKT-1 is built).** The current plugin repo keeps its own marketplace file, so `paqad@eliyce` installs and the project hook (`PLUGIN_REPO_URL`) keep working unchanged.
- **MKT-3 MUST (once MKT-1 is built).** Install and update point new installs at the configured marketplace only after the release has proven the entry is live, and leave an existing project's `.claude/settings.json` as it is until `paqad-ai update` runs.
- **MKT-4 MUST (once MKT-1 is built).** The sync check (`scripts/release-sync.mjs`) also fails when the configured marketplace entry is behind npm.

**Done when.** With the variable unset nothing changes; with it set, the entry updates on release, the old route still installs, and the sync check covers both.
**Test approach.** Unit tests of the entry update on a fixture marketplace file; a dry run of the release job.

## 6. The user's journey

1. A developer starts a full lane on a feature. Before the first stage, the band shows a range such as "about 2 to 3 hours and $4 to $7, based on 12 past full-lane changes in this project". (EST)
2. The stages run. At each stage end paqad keeps a checkpoint in a local ref. Nothing appears in the branch history or on the remote. (RES-1, RES-2)
3. Their own status-line script reads `.paqad/session/hud/<session>.json` and shows the stage name; the heartbeat tells it the session is alive. (RS, HB)
4. Two hours in, the provider's usage limit stops the lane during review. The band says what stopped, when it can continue, and the one action that continues it. (RES-4)
5. After the reset, the lane continues from the last finished stage. (RES-5, RES-6)
6. The change closes. The record shows the estimate and the actual figures side by side. (EST-5)
7. Weeks later, housekeeping has quietly kept `.paqad/` small. (HK)

## 7. Scenarios

| # | Scenario | What happens | Requirements |
| --- | --- | --- | --- |
| SC-1 | The session crashes | On the same machine, the next reader check sees the process gone and reports the session ended; the band and `paqad-ai doctor` agree. The next session start sweeps the stale heartbeat. | HB-2, HB-4, HB-5 |
| SC-2 | A usage limit stops the lane mid-stage | The stop and the reset time are recorded and shown. After the reset, the lane continues from the checkpoint of the last finished stage; finished stages are not run again. | RES-1, RES-3 to RES-6 |
| SC-3 | A teammate clones the project | They get the config and rulings only: no session files, no ledger, no checkpoints. Their first estimate uses the shipped defaults until their own history builds up, because the ledger is local. | DEC-3, RES-2, EST-2 |
| SC-4 | Another tool reads the status | It reads the snapshot and heartbeat, validates them against the shipped schema, ignores fields it does not know, and never writes to them. | RS-1 to RS-7 |
| SC-5 | The team hides the band | `hud.band: false` is committed. The band stays hidden for everyone, while the snapshot, heartbeat and evidence are still written for other tools. | DEC-8, HB-3, CFG-2 |
| SC-6 | Housekeeping runs | Once a day at session start it removes gone sessions' files and old closed bundles within the limits, writes one log line, and leaves open and paused changes alone. | HK-1 to HK-5 |
| SC-7 | A long lane in a project with no history | The estimate shows paqad's shipped defaults and says so; the lane starts without waiting on the estimate. | EST-2, EST-3, EST-7 |
| SC-8 | A reader meets a new major | The reader sees an unknown major, shows "status unknown" instead of failing, and the changelog says what changed. | RS-6, RS-7 |
| SC-9 | A checkpoint ref reaches a remote | `paqad-ai doctor` warns and names the refs; paqad itself never pushed them. | RES-2 |
| SC-10 | The plugin is listed in another marketplace | The release updates paqad's entry there; projects already set up keep installing from the old repo; new installs use the new marketplace once it is live. | MKT-1 to MKT-4 |

## 8. Delivery order

Foundations first: every later slice adds fields to the files the read surface declares, so the surface and its schemas come first.

| Slice | Contents | Depends on | Why this order |
| --- | --- | --- | --- |
| S0 | Prove U-1 to U-4 | none | The resume and heartbeat designs rest on them. |
| S1 | RS-1 to RS-7, RS-9, CFG-1, CFG-2 | none | The contract every other slice extends. |
| S2 | HB-1 to HB-6 | S1 | Adds the heartbeat schema and the liveness rule housekeeping needs. |
| S3 | HK-1 to HK-5 | S2 | Needs the "session gone" rule. |
| S4 | RES-1 to RES-3, RES-7, RES-8 (checkpoints) | S1 | Safe on its own and useful after any crash. |
| S5 | RES-4 to RES-6 (usage limit and continue) | S4, U-1, U-2 | Needs checkpoints and a proven way to detect the stop. |
| S6 | EST-1 to EST-8 | S1 | Adds `estimate.json` and the snapshot field under the read-surface rules. |
| S7 | RS-8, MKT-1 to MKT-4 | S1 | SHOULD items; the owner chooses when. |

## 9. Unknowns to prove in S0

- **U-1.** How a usage-limit stop shows itself to paqad (a hook event, a stop reason or a transcript record) on each supported host, and whether the reset time is available.
- **U-2.** What can continue a lane at the reset time without a person present, on each supported host.
- **U-3.** How the heartbeat writer learns the coding agent's process id (hooks see it as their parent process; whether the plugin engine exposes it), and how to read a boot id on macOS, Linux and Windows.
- **U-4.** The time a checkpoint takes through a temporary index on a large repository, and that ignored files stay out of it.

## 10. Open for the owner

- The default numbers in HK-4 (14 days, 90 days, 50 changes) and EST-2 (5 past changes).
- Whether the automatic continue in RES-6 is on by default.
- When to build S7.
