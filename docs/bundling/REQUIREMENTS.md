# Being bundled by another plugin: requirements (v1.0)

**Status:** v1.0, 26 November 2026. Requirements only: nothing here is built yet. Progress lives in [`PROGRESS.md`](PROGRESS.md).
**Owner:** paqad.
**Priority:** a launch blocker for any product that bundles paqad. The first two such products cannot ship their single plugin until this work is done.
**Scope:** what paqad must do so another product can ship a copy of paqad inside its own plugin, under its own name, without paqad's code or behaviour naming that product.

**How to read this:** MUST is required. SHOULD is a default that can change with a recorded reason. MAY is optional. Requirement IDs are for building and testing; users never see them. **Fact** means checked in this repository at `origin/main` 7fefa3ee on 26 November 2026, with the file named. **Ref** points to the owner's ruling in the research workspace that the requirement comes from (for example "research D146"). Anything not yet proven is listed in section 9.

**Words used here:**

- **Host product:** a product built on paqad that ships paqad inside its own plugin.
- **Bundling plugin:** the host product's plugin, holding its own copy of paqad.
- **Bundle config:** the settings the bundling plugin ships for its paqad copy (display name, plugin id, agent name prefix). Proposed: one file at the root of the bundled paqad copy. Settle the name and place in the build.
- **Bundled mode:** paqad running from a bundling plugin, known by the bundle config being present.

---

## 1. Why this work

Two products built on paqad will each ship one plugin that holds paqad inside it. A person installs one plugin, sees one name and one band, and paqad stays the enforcement engine underneath. The owner ruled this way to remove the confusion of several products' names, prompts and bands on one screen (research D123).

Today paqad assumes it is the only plugin and the only name in a project. Its name is in every message, its plugin id and agent names are fixed in code, it reads one machine-wide install, and it updates itself. Each of those breaks when paqad runs inside someone else's plugin.

Background note: the first host products are Baori and Egret. That is the only place this document names them. Every requirement below speaks of "the host product" or "the bundling plugin", and no paqad code, message or behaviour may name a host product.

## 2. Where things stand (facts)

| Area | Today | Source |
| --- | --- | --- |
| Plugin id | Fixed as `paqad@eliyce`, with the marketplace key `eliyce` and the repo `Eliyce/paqad-claude-plugin`. Team settings write these into `.claude/settings.json` (`enabledPlugins`, `extraKnownMarketplaces`). | `src/health/plugin-install.ts` (`PLUGIN_ID`, line 19), `src/install/plugin-settings-keys.ts`, `src/adapters/claude/team-settings.ts` |
| Agent names | The managed ignore blocks match `paqad-*` (agents) and `paqad-*/` (skills). Hook matchers expect `paqad:` and `paqad-` in agent names. | `src/onboarding/gitignore-writer.ts` (`AGENTS_IGNORE_LINES`, `SKILLS_IGNORE_LINES`), `src/adapters/shared/paqad-hooks.ts` (`PAQAD_STAGE_AGENT_MATCHER` and the matchers next to it) |
| Framework path | `.paqad/framework-path.txt` is committed. Onboarding writes either `~/.paqad-ai/current` or, when `PAQAD_FRAMEWORK_HOME` is set, the literal text `$PAQAD_FRAMEWORK_HOME`. The machine-wide link is `~/.paqad-ai/current` unless that variable is set. | `src/onboarding/manifest-writer.ts` (`resolveFrameworkInstallReference`), `src/health/plugin-install.ts` (`frameworkLinkHome`) |
| Missing framework | Every agent entry file says: if the framework path is missing or cannot be resolved, "proceed as a normal assistant with no paqad behavior. Do not block." Checks switch off without anyone being told. | `src/adapters/shared/framework-fallback-clause.ts` |
| Codex hooks | Hook commands are `node "<framework home>/hooks/<file>"`, and the framework home defaults to the machine-wide link, so Codex hooks run the separate npm install. | `src/adapters/codex/codex-adapter.ts`, `src/adapters/shared/paqad-hooks.ts` (`hookCommand`, `PAQAD_RUNTIME_PREFIX`) |
| Self-update | Two routes update paqad at session start: the `silent-update` hook ("Background, non-blocking forced self-update on every session start") for non-plugin installs, and `plugin-session-start.mjs`, which spawns `update --silent` at most every 6 hours for the plugin. | `src/adapters/shared/paqad-hooks.ts` (`silent-update`, `PLUGIN_EXCLUDED_HOOK_FILES`), `runtime/hooks/plugin-session-start.mjs` (`spawnSilentUpdate`) |
| Version setting | `paqad-ai config set` changes only `updates.automatic` and `updates.minimum_version`. Since 1.132.0, `updates.minimum_version` is an exact pin for the npm route and the cloud command; the plugin route can be stopped but not pinned. | `src/cli/commands/config.ts` (`SETTABLE_KEYS`), `CHANGELOG.md` 1.132.0 |
| Release notes | Changesets write `CHANGELOG.md`; the release job creates each GitHub Release from that version's section. A breaking change is a `major` changeset whose summary starts with "BREAKING". | `docs/RELEASE-WORKFLOW.md` sections 4 and the release job, `.changeset/README.md` |

## 3. Decisions made

Do not reopen these without a material reason. The research design is frozen (research D163): a ruling is reopened only when building or real use shows a better reason than the recorded one.

- **DEC-1.** paqad stays generic. No code, message, setting name or behaviour names a host product. Everything a host product changes, it changes through the bundle config or through settings paqad already has.
- **DEC-2.** Folders are fixed and never renamed. paqad keeps `.paqad/` and every path inside it, in bundled mode too; a host product adds its own folder next to it (research D130). The roughly 950 hard-coded `.paqad` paths stay as they are (research D131).
- **DEC-3.** paqad's own name stays where people audit, not where they work: evidence files, logs and one small "checks by Paqad" detail (research D123).
- **DEC-4.** A host product's bundle never uses the machine-wide install. Two projects on one machine never mix paqad versions (research D131 item 4, corrected by D146).
- **DEC-5.** Inside a bundle, the host product decides paqad's version. paqad does not update itself there (research D132, brought forward by D146).

Context that no longer applies, recorded so nobody builds it:

- **CTX-1.** The read surface (slice S1) and heartbeat (slice S2) in [`../local-status-and-resume/PROGRESS.md`](../local-status-and-resume/PROGRESS.md) are no longer launch blockers for host products. One bundle is one build with no version drift, and one bundled plugin draws one band (research D99, shrunk by D123). They stay useful on their own merits.
- **CTX-2.** `paqad-ai config set hud.band` is no longer needed for host products, because no second band has to be hidden (research D88, superseded by D123).
- **CTX-3.** paqad still gets its own Codex plugin, `Eliyce/paqad-codex-plugin`, for people who use paqad alone. Host products bundle paqad instead of depending on it (research D96, narrowed by D123).

## 4. What success looks like

- **SUC-1.** In a host product's project, a person never sees the word paqad while working: not in a message, prompt, stage line, hook stop, skill or agent label. They can still find it in the evidence, the logs and the "checks by Paqad" detail.
- **SUC-2.** A teammate who clones the project gets the host product's plugin turned on, and paqad's checks run from that plugin's own copy, on any machine, with no hand step.
- **SUC-3.** When the bundled paqad cannot be found, the person is told that checks are off. Nothing switches off silently.
- **SUC-4.** The plugin, CI and the npm route all run the exact paqad version the host product tested.
- **SUC-5.** A person who still has paqad's own plugin installed sees one line pointing to the right plugin, and no second set of prompts.
- **SUC-6.** A host product can tell from paqad's release notes alone whether a release is major.

## 5. Requirements

### 5.1 Display name (NAME)

**Goal.** Every word a person sees uses the host product's name.
**Value to the user.** One product, one name on screen; no wondering which tool is speaking.
**Why.** Seeing paqad's name, prompts and bands inside another product's project confused people (research D123, D131 item 1).
**How it makes paqad solid.** One name source means no message is left behind when a product renames paqad, and the default keeps paqad's own output as it is.

- **NAME-1 MUST.** Every message, prompt, stage line, hook stop message, skill label and agent label takes its product name from one display name setting.
- **NAME-2 MUST.** The display name comes from the bundle config. Without a bundle config it is "Paqad", so paqad used alone keeps its own name.
- **NAME-3 MUST.** paqad's own name stays in evidence files, logs and one small "checks by Paqad" detail (DEC-3), whatever the display name.
- **NAME-4 MUST.** A test fails the build when a person-facing string names paqad directly instead of using the display name. Evidence and log writers are exempt.
- **NAME-5 MUST NOT.** Ship a host product's name anywhere in paqad's code or defaults (DEC-1).

**Done when.** With a bundle config that sets a test display name, a full lane and a blocked hook show only that name to the person; the evidence and logs still say paqad; without a bundle config, output reads "Paqad" as before.
**Test approach.** Unit tests over the message catalogue with a test display name; a snapshot test of a hook stop message; the NAME-4 guard test.
**Ref.** Research D123, D131 item 1.

### 5.2 Plugin id in host settings (PID)

**Goal.** The project's host settings turn on the plugin the person actually uses.
**Value to the user.** A teammate who clones the project gets the host product's plugin, not paqad's.
**Why.** Team settings write `paqad@eliyce` into `.claude/settings.json` today (fact: `src/health/plugin-install.ts:19`, `src/adapters/claude/team-settings.ts`), which would turn on the wrong plugin in a host product's project.
**How it makes paqad solid.** The plugin id, marketplace key and marketplace repo become data, so install, update, join and doctor all agree on one plugin.

- **PID-1 MUST.** In bundled mode, paqad writes the bundling plugin's id into the project's host settings (for example `enabledPlugins` in `.claude/settings.json`) instead of `paqad@eliyce`.
- **PID-2 MUST.** The plugin id, the marketplace key and the marketplace source come from the bundle config, read in one place that replaces the fixed `PLUGIN_ID` and `PLUGIN_MARKETPLACE_REPO`.
- **PID-3 MUST.** Every reader of the plugin id (install, update, join, doctor, the "is the plugin installed" check) uses the same value.
- **PID-4 MUST.** In bundled mode, paqad never adds `paqad@eliyce` to a project's host settings.

**Done when.** Onboarding in bundled mode writes the bundling plugin's id and marketplace into `.claude/settings.json` and no `paqad@eliyce` key; doctor checks for that plugin.
**Test approach.** Unit tests of the settings writer with and without a bundle config; a doctor test in bundled mode.
**Ref.** Research D131 item 2.

### 5.3 Agent name prefix (AGT)

**Goal.** Renamed agents and skills stay covered by paqad's ignore rules and hooks.
**Value to the user.** Generated agent files never land in a commit, and stage checks keep running on renamed agents.
**Why.** The managed ignore blocks match `paqad-*` (fact: `src/onboarding/gitignore-writer.ts`), and the hook matchers expect `paqad:` and `paqad-` (fact: `src/adapters/shared/paqad-hooks.ts`). Renamed agents would be committed by mistake and would skip their checks.
**How it makes paqad solid.** One prefix setting drives the file names, the ignore rules and the matchers together, so they cannot drift apart.

- **AGT-1 MUST.** The agent and skill name prefix comes from a setting, set by the bundle config, defaulting to `paqad-`.
- **AGT-2 MUST.** The managed ignore blocks for agents and skills use that prefix.
- **AGT-3 MUST.** The hook matchers for stage agents, stage helpers, onboarding agents and subagent start use the prefix and the bundling plugin's namespace.
- **AGT-4 SHOULD.** When the prefix changes, the managed block also keeps ignoring files with the old prefix until they are gone, so nothing left over is committed.

**Done when.** With a test prefix, the written agents carry it, `git status` shows none of them, and a stage agent with the test prefix triggers the same hooks as `paqad-` does today.
**Test approach.** Unit tests of the ignore block and the matchers with a test prefix; one integration test that writes agents in a temporary repository and checks `git status`.
**Ref.** Research D131 item 3.

### 5.4 Framework path on every machine (FW)

**Goal.** The bundled paqad finds its own copy on every machine, every session.
**Value to the user.** Checks run for every teammate and in CI without anyone setting a path by hand, and each project uses the paqad version its host product shipped.
**Why.** Onboarding writes the literal `$PAQAD_FRAMEWORK_HOME` into the committed `.paqad/framework-path.txt` when that variable is set (fact: `src/onboarding/manifest-writer.ts`), and otherwise the machine-wide `~/.paqad-ai/current`. On another machine the first may not resolve and the second may be a different version. When the path does not resolve, the entry file tells the agent to carry on with no paqad behaviour and not block (fact: `src/adapters/shared/framework-fallback-clause.ts`), so checks switch off silently.
**How it makes paqad solid.** The path is a fact found at start-up instead of a guess written once, and losing the checks becomes visible.

- **FW-1 MUST.** In bundled mode, paqad uses the bundling plugin's own copy of paqad, never the machine-wide `~/.paqad-ai/current` (DEC-4).
- **FW-2 MUST.** The path is resolved at session start on each machine, from where the bundling plugin is installed there.
- **FW-3 MUST NOT.** Write an unexpanded placeholder such as the literal `$PAQAD_FRAMEWORK_HOME`, or a path that is only true on one machine, into a committed file.
- **FW-4 MUST.** In bundled mode, when the framework cannot be resolved, paqad gives a loud warning instead of the silent fallback: "Checks are off: <display name> missing", shown at session start and in the agent's first reply, with the one action that fixes it.
- **FW-5 MUST.** The agent entry files paqad writes keep pointing to `.paqad/framework-path.txt` (DEC-2), and their fallback wording in bundled mode says to warn, not to carry on quietly.

**Done when.** Two clones of one project on two machines, with the bundling plugin installed in different places, both run the bundled paqad; no committed file changes between them; with the plugin removed, the session opens with the warning.
**Test approach.** Unit tests of path resolution with a fake plugin root and no machine-wide link; a test that the committed files hold no placeholder; a snapshot test of the warning and of the bundled fallback clause.
**Ref.** Research D131 item 4, corrected by D146.

### 5.5 Codex hooks (CDX)

**Goal.** On Codex, the hooks paqad writes run the bundled copy.
**Value to the user.** The checks a Codex user meets are the version their host product tested, not whatever npm install sits on the machine.
**Why.** Codex hook commands are built from the framework home, which defaults to the machine-wide link (fact: `src/adapters/codex/codex-adapter.ts`, `hookCommand` in `src/adapters/shared/paqad-hooks.ts`).
**How it makes paqad solid.** Claude Code and Codex run the same paqad copy in one project.

- **CDX-1 MUST.** In bundled mode, the hooks paqad writes for Codex point into the bundling plugin's own versioned folder, not the separate npm install.
- **CDX-2 MUST.** When the bundling plugin updates, the hook paths follow the new version folder at the next session start, with no hand step.
- **CDX-3 MUST.** If the folder the hooks point to is missing, the FW-4 warning applies.

**Done when.** In bundled mode on Codex, `.codex/hooks.json` names the bundling plugin's folder, and a hook run uses the bundled version with the npm install removed.
**Test approach.** Unit tests of the Codex hook writer with a fake plugin folder; a test that an update rewrites the paths.
**Ref.** Research D131 item 5.

### 5.6 Self-update off inside a bundle (UPD)

**Goal.** A bundled paqad never changes its own version.
**Value to the user.** The paqad inside the host product is always the one the host product tested together with its own code.
**Why.** paqad updates itself at session start through two routes (fact: the `silent-update` hook in `src/adapters/shared/paqad-hooks.ts`, and `spawnSilentUpdate` in `runtime/hooks/plugin-session-start.mjs`). Inside a bundle that would bypass the host product's tested build.
**How it makes paqad solid.** One owner per version: the host product's release.

- **UPD-1 MUST.** In bundled mode, the forced self-update at session start is off, on both routes.
- **UPD-2 MUST.** In bundled mode, a message that would tell the person to run `paqad-ai update` (for example "plugin and runtime differ") tells them to update the bundling plugin instead, using the display name.
- **UPD-3 MUST.** `paqad-ai update` run by hand in bundled mode explains that updates come with the bundling plugin and changes nothing.

**Done when.** A bundled session start spawns no update on either route, and no message suggests `paqad-ai update`.
**Test approach.** Unit tests of both session-start routes through their injected update seams, with and without a bundle config.
**Ref.** Research D132, D146.

### 5.7 Version managed by the host product (VER)

**Goal.** Every route that runs paqad in the project runs the version the host product bundled.
**Value to the user.** CI, the cloud command and npm users get the same paqad as the plugin, so a check never passes in one place and fails in another.
**Why.** `updates.minimum_version` already pins the npm route and the cloud command to an exact version (fact: `CHANGELOG.md` 1.132.0, `src/cli/commands/config.ts`). What is missing is a way to mark it as owned by the host product and to keep it right.
**How it makes paqad solid.** The tested combination is written down in the project and restored when someone changes it.

- **VER-1 MUST.** The host product writes the exact bundled paqad version into `updates.minimum_version`, marked as managed by the bundling plugin, through `paqad-ai config set` or the same writer.
- **VER-2 MUST.** When someone edits a managed value, paqad shows a warning naming the bundling plugin by its display name, and resets the value to the bundled version at the next session start.
- **VER-3 MUST.** The managed mark is generic data (for example the bundling plugin's id), never a host product name in paqad's code.
- **VER-4 MUST.** CI and the npm route then install that exact version, as `updates.minimum_version` already does.

**Done when.** After a host product upgrade, `updates.minimum_version` holds the bundled version and its managed mark; an edit shows the warning and is reset at the next session; the cloud command and npm install that version.
**Test approach.** Unit tests of the managed write, the edit warning and the reset; a test of the cloud command's version line.
**Ref.** Research D146.

### 5.8 A hint when another product manages the project (HINT)

**Goal.** paqad on its own knows when a host product manages the project, and steps aside.
**Value to the user.** Someone who still has paqad's own plugin or npm install sees one clear line, not two sets of prompts.
**Why.** With two plugins installed, only the one that matches the project may act (research D143 item 5), and paqad must find this out without knowing any host product (DEC-1).
**How it makes paqad solid.** One committed marker inside paqad's own folder replaces any guess about other products' folders.

- **HINT-1 MUST.** A host product writes a committed marker inside `.paqad/` that says a product built on paqad manages the project. Proposed: `.paqad/configs/bundle.yaml`, with the bundling plugin's id and display name. Settle the name in the build.
- **HINT-2 MUST.** paqad's managed ignore rules keep that marker in git. Leftover git-ignored files never count as a marker (research D144).
- **HINT-3 MUST.** paqad on its own (its own plugin, its npm install) that finds the marker stays silent except for one line: "This project is managed by a product built on Paqad; use its plugin." It MAY add the bundling plugin's id from the marker.
- **HINT-4 MUST NOT.** Detect a host product by reading any folder other than `.paqad/`, or by any product name.

**Done when.** In a project with the marker, paqad's own plugin shows the one line and nothing else; without it, paqad behaves as today; a fresh clone sees the marker.
**Test approach.** Unit tests of marker detection and of the managed ignore block; a session-start test with and without the marker.
**Ref.** Research D131, D144.

### 5.9 Release notes say when a release is major (REL)

**Goal.** A host product sees at once whether a paqad release is major.
**Value to the user.** A breaking change in paqad never reaches a host product's users disguised as a patch.
**Why.** A host product's version bump follows the biggest change below it: a paqad major gives a host product major (research D162). The host product's automatic build needs to read that from paqad's release.
**How it makes paqad solid.** The bump level becomes an explicit, checked part of every release.

- **REL-1 MUST.** Every GitHub Release and its `CHANGELOG.md` section states the bump level (major, minor or patch) in a fixed place a script can read.
- **REL-2 MUST.** A major release lists what a host product must change, as the "BREAKING" changeset summary already asks (`docs/RELEASE-WORKFLOW.md` section 4).
- **REL-3 SHOULD.** The release job fails when a major has no "BREAKING" summary.

**Done when.** A script reading only the GitHub Release tells major, minor and patch apart for the last three releases of each kind.
**Test approach.** A unit test of the release-notes step on fixture changelogs; a dry run of the release job.
**Ref.** Research D162.

## 6. The user's journey

1. A developer installs a host product's plugin and sets up a project. Every line they read carries the host product's name. (NAME)
2. The project's `.claude/settings.json` turns on the host product's plugin, and `.paqad/configs/` holds the marker and the managed version. (PID, HINT, VER)
3. A teammate clones the project on another machine. The plugin starts, finds its own paqad copy there, and the checks run. (FW)
4. The teammate uses Codex. The hooks run the same bundled copy. (CDX)
5. Nothing updates paqad behind the host product's back; CI installs the same version. (UPD, VER)
6. Someone still has paqad's own plugin. It shows one line pointing to the right plugin and stays quiet. (HINT)
7. paqad ships a major. The host product's build sees it in the release notes and ships a major too. (REL)

## 7. Scenarios

| # | Scenario | What happens | Requirements |
| --- | --- | --- | --- |
| SC-1 | A hook blocks a wrong edit in a host product's project | The stop message uses the host product's name; the evidence says paqad. | NAME-1 to NAME-3 |
| SC-2 | A teammate clones on a new machine | The host product's plugin is turned on; paqad resolves its own copy there; no committed file changes. | PID-1, FW-1 to FW-3 |
| SC-3 | The bundling plugin was uninstalled | The session opens with "Checks are off: <display name> missing" and the fix; nothing switches off quietly. | FW-4, FW-5, CDX-3 |
| SC-4 | Someone edits the managed version | A warning names the bundling plugin; the next session resets the value. | VER-2 |
| SC-5 | paqad's own plugin is still installed | It shows one hint line and nothing else. | HINT-3 |
| SC-6 | Renamed agents are written | The ignore rules and hook matchers use the new prefix; nothing is committed by mistake. | AGT-1 to AGT-3 |
| SC-7 | A paqad major ships | The release notes say major; the host product's build bumps its own major. | REL-1, REL-2 |
| SC-8 | paqad is used alone | No bundle config, no marker: everything behaves as today. | NAME-2, PID-4, HINT-3 |

## 8. Delivery order

Every slice reads the bundle config, so it comes first.

| Slice | Contents | Depends on | Why this order |
| --- | --- | --- | --- |
| B0 | Prove U-1 to U-3; settle the bundle config's name, place and fields | none | The path and Codex designs rest on them. |
| B1 | NAME-1 to NAME-5 | B0 | The largest change; touches every message. |
| B2 | PID-1 to PID-4, AGT-1 to AGT-4 | B0 | Small, and needed before any project is set up in bundled mode. |
| B3 | FW-1 to FW-5, CDX-1 to CDX-3 | B0, U-1, U-2 | Needs a proven way to find the plugin on each host. |
| B4 | UPD-1 to UPD-3, VER-1 to VER-4 | B0 | Version ownership moves to the host product together. |
| B5 | HINT-1 to HINT-4 | B2 | Uses the plugin id from the bundle config. |
| B6 | REL-1 to REL-3 | none | Release tooling only; can ship any time. |

## 9. Unknowns to prove in B0

- **U-1.** How a session-start hook and the agent entry file learn where the bundling plugin is installed on each host (Claude Code gives `${CLAUDE_PLUGIN_ROOT}` to hooks; whether the agent can read the resolved path, and where a machine-local copy of it lives).
- **U-2.** Whether Codex gives a plugin's hooks a stable root folder like Claude Code does, and how its plugin folders are versioned.
- **U-3.** Which person-facing strings live outside `src/` (runtime hooks, plugin skills and agents, entry-file templates), so NAME-4's guard covers them all.

## 10. Open for the owner

- Whether paqad used alone also replaces the silent fallback with the FW-4 warning.
- The casing of the default name: the requirement says "Paqad", while many of today's messages write "paqad".
- The final name and place of the bundle config and of the committed marker.
