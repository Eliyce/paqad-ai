# How Paqad Works for Onboarded Projects

> **What this file is.** The canonical, plain-language map of what paqad-ai does
> *inside a project that has installed and onboarded it* (React, Go, C++, Python,
> any stack), from the moment an AI provider opens a session to the moment a
> change is verified and recorded. It is the single "start here" overview of the
> onboarded-project runtime.
>
> It deliberately **points to the code and the per-module docs instead of
> duplicating them**, so it stays small and the links stay authoritative. If you
> arrived here from a reference elsewhere: this is the framework's
> behaviour-in-an-onboarded-repo overview, not a spec for one module.
>
> **Audience.** Maintainers, and any AI agent working in this repo that needs the
> whole-system picture before touching a part.
>
> **Authority.** The single source of truth for module slugs and source paths is
> [`docs/instructions/rules/module-map.yml`](../instructions/rules/module-map.yml).
> Where this overview and the module-map disagree, the module-map wins.
>
> **Keep it current.** Governed by
> [`docs/instructions/rules/_shared/onboarded-overview-maintenance.md`](../instructions/rules/_shared/onboarded-overview-maintenance.md).
> When the stages, the skill/agent roster, or the consciousness engines change,
> update this file in the same change.

---

## 0. The one-sentence version

paqad-ai turns a generic AI coding assistant into one that **loads the project's
contract before it is allowed to edit, classifies and routes every request, runs
it through explicit stages, and refuses to call a change "done" until
language-agnostic verification gates pass** — so a change is made with knowledge
of the existing modules, docs, and tests, instead of in isolation.

Two product surfaces sit on top of one engine:

1. **cli-commands** — what a human runs in the terminal (`paqad-ai onboard`,
   `refresh`, `doctor`, `dashboard`, …). No LLM in the loop.
2. **agent-workflows** — what the AI does once it loads the entry file and follows
   the runtime rules, skills, and agent roles shipped in the package.

The rest of this document is about surface 2: the runtime an onboarded team's AI
provider actually executes.

---

## 1. The life of one request, end to end

A request travels through three arcs: **attach → route → execute-and-record.**

### 1a. Onboarding attaches the framework to the repo (one time)

`paqad-ai onboard` detects the stack from **lockfiles, not folder names**
(`package.json`, `go.mod`, `Gemfile`, …), so detection behaves the same in every
language ([`stack-detection-engine`](stack-detection-engine/index/summary.md),
`src/detection`). Onboarding then writes, deterministically and idempotently
([`src/onboarding/orchestrator.ts`](../../src/onboarding/orchestrator.ts)):

- **Thin per-provider entry files** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `.cursor/rules/…`, `.github/copilot-instructions.md`, etc. Each is ~25 lines of
  prose that tells the AI to go load the framework; it is **not** the framework
  ([`adapter-onboarding`](adapter-onboarding/index/summary.md), `src/adapters`).
- **Provider config** — MCP server paths and lifecycle hooks (entry-gate,
  prompt-gate, session-start, completion) in each provider's native format.
- **Shared, language-neutral context** — `docs/instructions/rules` (project-owned,
  never clobbered), `docs/instructions/stack`, `docs/modules` scaffolds.
- **`.paqad/` metadata** — `framework-path.txt` (one pointer to the shared
  `~/.paqad-ai/current` install), `project-profile.yaml` (project facts only:
  stack + the project's own test/build/lint commands + active capabilities), the
  framework knobs in the four-surface config layer (strictness, RAG, enterprise,
  escalation, features, model routing, …) — defaults in
  `src/core/framework-config.ts`, tracked team overrides in
  `.paqad/configs/.config.*` (onboarding writes one self-documenting file per
  group, every knob commented out at its default), a git-ignored local
  `.paqad/.config` (local wins), and `PAQAD_*` env — and the onboarding manifest
  ([`project-profile-schema`](project-profile-schema/index/summary.md)).

On **Claude Code only**, the framework can also install as a **plugin** instead of
the npm package. The plugin ships its own manifest
([`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)) and a marketplace
([`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)), both
generated at build by [`scripts/build-plugin-manifest.mjs`](../../scripts/build-plugin-manifest.mjs)
from the one hook renderer and stage-agent template (no second copy). The `eliyce`
marketplace stays in this repo (`Eliyce/paqad-ai`), and its `paqad` entry installs from the
public repo `Eliyce/paqad-plugin`. On every published release the `publish-plugin` job in
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) builds the package,
assembles the plugin tree with [`scripts/assemble-plugin.mjs`](../../scripts/assemble-plugin.mjs)
(`.claude-plugin/plugin.json`, `package.json`, `dist/`, `runtime/` without the mod tests,
`README.md` and `LICENSE`), pushes it to that repo and tags it `v<version>`. It pushes with the
repository secret `PAQAD_PLUGIN_PUSH_TOKEN`; with the secret unset it prints a notice and
skips the publish. The script refuses a `plugin.json` whose version differs from
`package.json`, so it only runs after `pnpm build`, and it keeps the output folder's `.git`, so
`pnpm build && node scripts/assemble-plugin.mjs <clone of Eliyce/paqad-plugin>` seeds the repo
by hand. It needs **no
install step**: `dist/` bundles every pure-JS dependency (`tsup.config.ts` `noExternal`),
so it works the moment it is downloaded. Its hooks
([`runtime/claude-plugin/hooks.json`](../../runtime/claude-plugin/hooks.json)) are the
same live chain, rooted at `${CLAUDE_PLUGIN_ROOT}/runtime`, plus a plugin-only
SessionStart bootstrap ([`runtime/hooks/plugin-session-start.mjs`](../../runtime/hooks/plugin-session-start.mjs))
that keeps `~/.paqad-ai/current` pointing at a copy that exists (a Windows junction, never
replacing a real directory) and puts the plugin's own `paqad-ai`
([`runtime/claude-plugin/bin/`](../../runtime/claude-plugin/bin)) on the session PATH.
Every other host keeps using the npm package exactly as today. When both copies are installed, exactly one hook chain runs per session. If the user or project Claude settings still wire a live npm hook, the plugin stays passive and every plugin hook stands down for that session, so the npm chain does the work. Otherwise the same bootstrap claims the session with a per-session marker and the npm hooks step aside. Every hook asks one shared check for this, `hookStandsDown` in [`runtime/hooks/lib/paqad-disabled.mjs`](../../runtime/hooks/lib/paqad-disabled.mjs). Two copies of the plugin can also be live in one session, for example a copy installed from the marketplace and one the Desktop app synced from claude.ai. The per-session marker then records the `CLAUDE_PLUGIN_ROOT` that claimed the session, written with an exclusive create so the first root wins, and a hook reached from any other root stands down (`pluginRootStandsDown`, the fourth clause of `hookStandsDown`). The other root stands down only while the claiming root is still live: a synced copy, or a root Claude Code still lists in `installed_plugins.json` (when that file cannot be read, the claiming root counts as live). A marker written before roots were recorded, or one whose claiming root is gone from disk, claims for every root. When the claiming root is on disk but no longer live, the hook that reached it takes the session over by rewriting the marker with its own root. So the copy that runs is never left without its gates. A claimed session also prunes dead npm hook lines and the home stage agents, and refreshes the project in the background when the plugin is newer. The plugin ships the `/paqad:onboard`, `/paqad:join`, and `/paqad:dashboard` skills ([`runtime/claude-plugin/skills/`](../../runtime/claude-plugin/skills)), a HUD mod ([`runtime/claude-plugin/mod/`](../../runtime/claude-plugin/mod)) that shows where the change stands in a band above the prompt and answers the `/paqad` commands (it only shows and never decides, see the [HUD band](feature-evidence/index/summary.md)), and the heavy RAG engines resolve on demand through [`src/core/optional-package.ts`](../../src/core/optional-package.ts), installing into `${CLAUDE_PLUGIN_DATA}` in the background when they are missing.

**Moving an npm machine to the plugin.** A machine already on the npm setup can be moved to the plugin automatically by [`src/install/plugin-migration.ts`](../../src/install/plugin-migration.ts). It is off by default; `plugin_migration=on` or `claude_install_mode=plugin` turns it on. `claude_install_mode=settings` and an explicit opt-out in Claude settings (`enabledPlugins["paqad@eliyce"] = false`) are respected before anything runs. The move happens inside the background `update --silent` run. It decides in one order. First the managed policy: `classifyManagedPolicy` reads the managed-settings files and returns `hooks-blocked` (`allowManagedHooksOnly` or `disableAllHooks`), `plugin-blocked` (`enabledPlugins` false for the plugin, a strict marketplace list without it, or a blocked marketplace) or nothing; either block records `skipped` with the reason `managed-policy` and writes nothing, even when the plugin was already seen. Then a plugin that is already present: a copy synced from claude.ai (under `plugins/synced/`, or the Desktop app's `Claude/local-agent-mode-sessions/.../rpm/plugin_...` folder on macOS and Windows) records `done` with the path `synced` and is never installed or declared again; any other present copy has its settings keys declared again. Then, under a machine lock that is cleared if a killed run left it behind for more than 15 minutes, the install. Path A: when `claude` on the path is at least the minimum version, paqad runs `claude plugin marketplace add Eliyce/paqad-ai` and `claude plugin install paqad@eliyce --scope user`, waits for them, and checks that Claude Code recorded the plugin; a failure records `failed` with the reason `path-a-failed:<why>`, for example `path-a-failed:cli-install-failed:exit`. Path B: with no usable `claude` on the path, `findBundledClaude` looks for the `claude` that ships inside the Claude Desktop app, under `~/Library/Application Support/Claude/claude-code/<version>/` on macOS or `%APPDATA%\Claude\claude-code\<version>\` on Windows, and takes the highest version folder that holds an executable binary. It runs the same two commands with it and records `installed` with the path `bundled-cli`. Nothing found records `skipped` with `no-claude-cli`, a `claude` on the path older than the minimum with no bundled `claude` records `skipped` with `claude-too-old:<version>`, and a failed run records `skipped` with `bundled-cli-failed:<why>`. Neither writes the user settings, and paqad stays on npm. There is no settings-only fallback any more: in a headless `claude -p` session Claude Code registered a marketplace declared in settings but never installed the plugin, so a settings-only declare is not treated as an install. paqad only ever runs a `claude` found in the Desktop app's own folder in the user's home, never a path read from a project. It never edits a project file, and the npm package stays installed as a fallback, so paqad is never off.

After the move the state is `installed`. paqad then counts real Claude Code sessions: the npm SessionStart hook ([`runtime/hooks/silent-update.mjs`](../../runtime/hooks/silent-update.mjs)) and the plugin bootstrap both call [`runtime/hooks/lib/plugin-migration-tick.mjs`](../../runtime/hooks/lib/plugin-migration-tick.mjs), which starts the hidden `paqad-ai plugin tick` in the background. Each session counts once, by its session id (the last 10 are kept). When the plugin runs, the state becomes `done`. A session only counts once Claude Code has installed the plugin (it lists it in `~/.claude/plugins/installed_plugins.json`), because the Desktop app can take a few starts to install a plugin declared in settings. Until then a session just waits, and if the plugin is still not installed 7 days after the move, paqad undoes it with the reason `plugin-never-installed` and tries again later, like any automatic undo. After the install, if three sessions pass with no sign of the plugin, paqad undoes the move (reason `plugin-never-loaded`), removing the plugin with `claude plugin uninstall` when Claude Code lists it, and tries again a day later, up to five attempts, so a blocked download recovers once access is back. A `paqad-ai plugin rollback` the user runs is final: it removes the plugin, sets `claude_install_mode=settings`, and never re-migrates. It uninstalls through `claude` on the path, then through the Desktop app's bundled `claude`. When neither can be run, or the uninstall fails, and Claude Code still lists the plugin, it turns the plugin off in the user's Claude settings and prints: The plugin is turned off. Run `claude plugin uninstall paqad@eliyce` to remove it. When those settings cannot be read or written, it prints instead: paqad could not turn the plugin off. Run `claude plugin uninstall paqad@eliyce` to remove it. The plugin and paqad-ai versions on the doctor line are read from `CLAUDE_CONFIG_DIR` when that is set. If the user turns the plugin off after `done`, paqad records `declined` with the reason `user-disabled` and never turns it back on. A skip caused by the user's own config or environment does not make a later opt-in wait a day, but it does not reset the attempt count or the retry window of a real attempt either.

The state lives in `~/.paqad-ai/plugin-migration.json` (`state`, `path`, `reason`, `attempts`, `last_attempt_at`, plus `installed_at`, `counted_sessions`, `last_real_attempt_at`, and `last_real_reason`). The details go to `~/.paqad-ai/logs/plugin-migration.log`, and `paqad-ai doctor` shows one "Claude Code install" line that says what is installed, checked in this order. A managed policy that blocks paqad's hooks is a warning, "A managed policy blocks paqad's hooks, so paqad's checks don't run here.", with the fix "Ask IT to deploy the paqad plugin as a managed plugin, or allow its hooks.". A policy that blocks the plugin reads `plugin blocked by policy; paqad stays on npm`. A plugin that Claude Code lists as installed and enabled, with no npm copy (the framework link is not an npm copy and the running CLI is not under `node_modules`), reads `plugin` whatever the migration record says. A copy synced from claude.ai reads `plugin (synced from claude.ai)`. Otherwise the record decides: `npm`, `plugin (migrated <date>, via <path>)`, `npm (migration declined: user-disabled)`, `npm (migration installed: waiting for Claude Code to install the plugin)` while the move waits for the install, `npm (moving to the plugin: waiting for the plugin to load in a new session)` once Claude Code installed it but it has not run yet, and `npm (migration <state>: <reason>)` for a stored reason such as `path-a-failed:cli-install-failed:exit`, `no-claude-cli`, `claude-too-old:<version>` or `bundled-cli-failed:<why>`. A state with no reason is shown without one. When the plugin is installed, the plugin and paqad-ai lines end with both versions, for example `; plugin v1.99.4, paqad-ai v1.99.4`. The plugin version comes from the plugin root (the `installPath` package.json in `installed_plugins.json`, then the record's own version, then the `version` file of the runtime copy), and a mismatch, usually a stale plugin cache, is a warning. The "Framework install" line reads the copy's version the same way and leaves the version out rather than print an unknown one. When the move is done but a settings file still wires a live paqad npm hook, the plugin stays passive in that project and the line ends by naming the file that keeps the npm hooks on. It checks the files in the order the hooks do: the user's `~/.claude/settings.json` first (or `settings.json` in `CLAUDE_CONFIG_DIR` when that is set, named by its real path), then the project's `.claude/settings.json` and `settings.local.json`. The user file alone reads `; this project still runs the npm hooks (~/.claude/settings.json)`, the project files alone read `; this project still runs the npm hooks (project .claude/settings.json)`, and both read `; this project still runs the npm hooks (~/.claude/settings.json and project .claude/settings.json)`.

### 1b. Every session loads the contract before it can edit

When the provider opens a session it reads the entry file, resolves
`.paqad/framework-path.txt`, and loads the rules, stack, and design-system docs.
A **PreToolUse hook blocks every Edit / Write / NotebookEdit until** the AI has
done this and written its sentinel; read-only tools stay open so it can load
first. The sentinel is per session, at `.paqad/.agent-entry-loaded.d/<session id>`
(the single `.paqad/.agent-entry-loaded` file is used only when the host gives no
session id), and each SessionStart removes only its own, so two sessions in one
checkout never ungate each other. Editing `CLAUDE.md` or anything under
`docs/instructions/` mid-session invalidates the sentinel and forces a reload.
This gate is what makes "code with the project's context" non-optional rather than
a hope pinned to a prompt. See [`CLAUDE.md`](../../CLAUDE.md) and
[`adapter-onboarding`](adapter-onboarding/index/summary.md).

### 1c. The request is classified and routed

The raw prompt is matched to a canonical workflow, then classified into routing
dimensions, then assigned a lane:

- **Classify** — [`workflow-router`](../../runtime/base/skills/workflow-router/SKILL.md)
  then [`request-classifier`](../../runtime/base/skills/request-classifier/SKILL.md)
  produce workflow, complexity, risk, scope, affected modules, output type, and
  target capability ([`src/pipeline/classifier.ts`](../../src/pipeline/classifier.ts)).
- **Route to a lane** — the [`Router`](../../runtime/base/agents/router.md) agent
  consults a deterministic `(workflow, complexity, risk) → lane` table:
  **fast** (minimal local phases), **graduated** (adds spec + review gates),
  **full** (everything, including migration and pentest).
  ([`agent-routing`](agent-routing/index/summary.md), `src/core/capabilities.ts`.)

Capabilities (`content` / `coding` / `security`) gate which skills and agents are
even available ([`capability-model`](capability-model/index/summary.md)). The
lane decides which stages run and how strict each is.

### 1d. Stages run, gates verify, evidence is recorded

The chosen lane is an ordered sequence of stages
([`workflow-engine`](workflow-engine/index/summary.md),
[`src/workflows/engine.ts`](../../src/workflows/engine.ts)). The canonical
feature-development stages are named in §2. Throughout:

- The **Decision Pause Contract** forces the AI to write a Decision Packet and
  stop for a human at flagged junctions (reuse-vs-create, architecture path, spec
  change, module-slug collision)
  ([`decision-pause-contract`](decision-pause-contract/index/summary.md)).
- **Verification gates** (17 of them) decide whether the change may land. They run
  transparently in-pipeline **and again at a git/CI backstop independent of the
  agent** ([`verification`](verification/index/summary.md), `src/verification`).
- **Rule loading is required and evidenced**. Materializing the applicable
  rule text into the session-context artifact does not prove it was read, so a change
  must record that its rules were loaded: `paqad-ai rules load` writes `rules-loaded.json`
  into the feature bundle, the `rules-loaded` kernel capability blocks the first source
  edit until it exists, and the completion-seam `rules-loaded-gate` fails a change whose
  applicable rules were never loaded. It attests loading, never comprehension.
- **Visual evidence is asked for at every stage** (opt-in `visual_evidence`).
  A frontend change meets a readiness pause at `plan compile` when screenshots cannot be
  captured here, a `(proof: visual)` requirement at `spec freeze`, a one-time reminder at the
  first frontend edit, and the visual-evidence gate at Stop. The late gates
  (bundle-completeness, visual-evidence, rules-loaded) are recorded in the bundle's
  `evidence.jsonl`, skips included
  ([`visual-evidence`](visual-evidence/index/summary.md)).
- Everything lands in the append-only **Evidence Ledger**, and a per-change
  provenance receipt is projected from it
  ([`evidence-ledger`](evidence-ledger/index/summary.md), `src/evidence`).

Runs checkpoint atomically and resume from the first incomplete step; cancellation
is cooperative ([`session-handoff`](session-handoff/index/summary.md)).

---

## 2. The feature-development stages

Customised by
[`docs/instructions/workflows/feature-development.yaml`](../instructions/workflows/feature-development.yaml);
the framework owns phase order and the mandatory safety stages.

| Stage | What happens | Skills / agents that fire |
| --- | --- | --- |
| **planning** | Read canonical docs first; confirm scope; attribute the change to a module | [`scope-check`](../../runtime/base/skills/scope-check/SKILL.md), [`requirement-enrichment`](../../runtime/base/skills/requirement-enrichment/SKILL.md), [`edge-case-detection`](../../runtime/base/skills/edge-case-detection/SKILL.md), the Attribution Gate ([`module-attribution-extractor`](../../runtime/base/skills/module-attribution-extractor/SKILL.md) → [`-inferencer`](../../runtime/base/skills/module-attribution-inferencer/SKILL.md)), [`module-map-reconciler`](../../runtime/base/skills/module-map-reconciler/SKILL.md), [`rule-script-reconciler`](../../runtime/base/skills/rule-script-reconciler/SKILL.md). **Reuse-first:** the reuse reflex on every lane, then [`diff-minimizer`](../../runtime/base/skills/diff-minimizer/SKILL.md) + [`existing-doc-checker`](../../runtime/base/skills/existing-doc-checker/SKILL.md) on graduated/full before the plan compiles, and [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) on a multi-module graduated/full change. Agents: [Requirement Analyst](../../runtime/base/agents/requirement-analyst.md), [solution-architect](../../runtime/capabilities/coding/agents/solution-architect.md), [data-modeler](../../runtime/capabilities/coding/agents/data-modeler.md) |
| **specification** | Freeze acceptance criteria and invariants before code (graduated/full need human sign-off) | [`acceptance-criteria-gen`](../../runtime/base/skills/acceptance-criteria-gen/SKILL.md), [`spec-diff`](../../runtime/base/skills/spec-diff/SKILL.md), [`spec-quality-review`](../../runtime/base/skills/spec-quality-review/SKILL.md), [`story-and-solution-writer`](../../runtime/base/skills/story-and-solution-writer/SKILL.md), [`sequence-planner`](../../runtime/base/skills/sequence-planner/SKILL.md), [`test-per-ac-planner`](../../runtime/base/skills/test-per-ac-planner/SKILL.md). Graduated/full add [`performance-regression-estimator`](../../runtime/base/skills/performance-regression-estimator/SKILL.md), [`rollback-safety-planner`](../../runtime/base/skills/rollback-safety-planner/SKILL.md) ([`diff-minimizer`](../../runtime/base/skills/diff-minimizer/SKILL.md) and [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) now run in **planning**). When `spec_pipeline_enabled` is on (the default) and the change is not on the fast lane, the stage runs the spec pipeline (`spec pipeline start` through `finish`, with [`expert-notes`](../../runtime/base/skills/expert-notes/SKILL.md) and [`expert-synthesis`](../../runtime/base/skills/expert-synthesis/SKILL.md) when experts are on) and freezes with `spec freeze --from-pipeline`. Agents: [Story Designer](../../runtime/base/agents/story-designer.md), [Test Planner](../../runtime/base/agents/test-planner.md), [Product Owner](../../runtime/base/agents/product-owner.md) |
| **development** | Write code under the [constitution](../instructions/rules/_shared/constitution.md): read module docs first, change only the requested scope, preserve user files, pair changes with tests, ask don't guess | Agents as relevant: [integration-architect](../../runtime/capabilities/coding/agents/integration-architect.md), [database-expert](../../runtime/capabilities/coding/agents/database-expert.md), [devops-engineer](../../runtime/capabilities/coding/agents/devops-engineer.md) |
| **review** | Digest first (`paqad-ai review digest`), then gates, then adversarial + gap passes, then final sign-off | [Verifier](../../runtime/base/agents/verifier.md), then [Adversarial Reviewer](../../runtime/base/agents/adversarial-reviewer.md) + [Gap Detector](../../runtime/base/agents/gap-detector.md) (+ [`adversarial-review`](../../runtime/base/skills/adversarial-review/SKILL.md), [security-auditor](../../runtime/capabilities/security/agents/security-auditor.md), [performance-analyst](../../runtime/capabilities/coding/agents/performance-analyst.md), [ux-ui-analyst](../../runtime/capabilities/coding/agents/ux-ui-analyst.md)), then [Final Reviewer](../../runtime/base/agents/final-reviewer.md). [`test-execution-feedback-loop`](../../runtime/base/skills/test-execution-feedback-loop/SKILL.md) proposes the smallest fix per failing test |
| **checks** | format → test → build, overlapped and with the runner's own parallel mode; every parallel-run failure confirmed alone before it blocks; plus module-health and diff-scoped rule scripts | [`rule-script-runner`](../../runtime/base/skills/rule-script-runner/SKILL.md), [`module-health-rollup`](../../runtime/base/skills/module-health-rollup/SKILL.md), [`test-runner-discovery`](../../runtime/base/skills/test-runner-discovery/SKILL.md) (only when `checks plan` reports the runner's parallel mode unknown) |
| **documentation_sync** | Sync only the docs the diff made stale | [`documentation-sync-engine`](../../runtime/base/skills/documentation-sync-engine/SKILL.md) routes to [`api-doc-maintainer`](../../runtime/base/skills/api-doc-maintainer/SKILL.md), [`integration-doc-maintainer`](../../runtime/base/skills/integration-doc-maintainer/SKILL.md), [`error-catalog-maintainer`](../../runtime/base/skills/error-catalog-maintainer/SKILL.md), [`canonical-doc-sync`](../../runtime/base/skills/canonical-doc-sync/SKILL.md), [`glossary-maintainer`](../../runtime/base/skills/glossary-maintainer/SKILL.md); [`diff-doc-sync`](../../runtime/base/skills/diff-doc-sync/SKILL.md) narrows the set |

---

## 3. Full catalog: every skill and agent, by lifecycle phase

This is the complete roster the framework ships into an onboarded repo: **45 base
skills, 30 coding skills, 11 security skills, 6 content skills, 22 agents.** Each
links to its definition; "knows" lists the existing-codebase signals it actually
consults. The authority for what exists remains
[`module-map.yml`](../instructions/rules/module-map.yml) and the runtime
directories.

### Classify / route
- [`workflow-router`](../../runtime/base/skills/workflow-router/SKILL.md) — match raw prompt to a canonical workflow. Knows: instructions.
- [`request-classifier`](../../runtime/base/skills/request-classifier/SKILL.md) — extract workflow/scope/impact/risk. Knows: instructions, module-map.
- [Router](../../runtime/base/agents/router.md) (agent) — pick fast/graduated/full lane deterministically. Knows: module-map, git.
- [Context Curator](../../runtime/base/agents/context-curator.md) (agent) — load only phase-relevant context within budget. Knows: docs/modules, source, module-map.
- [`session-resume`](../../runtime/base/skills/session-resume/SKILL.md) — rebuild compact session state after compaction. Knows: handoff metadata.
- [`context-budget-planner`](../../runtime/base/skills/context-budget-planner/SKILL.md) — estimate token footprint, recommend compaction. Knows: instructions, docs/modules.

### Requirements + spec
- [`scope-check`](../../runtime/base/skills/scope-check/SKILL.md) — is the request inside the approved spec boundary? Knows: docs/modules, instructions.
- [`requirement-enrichment`](../../runtime/base/skills/requirement-enrichment/SKILL.md) — expand thin requests across an operational checklist. Knows: docs/modules, instructions.
- [`acceptance-criteria-gen`](../../runtime/base/skills/acceptance-criteria-gen/SKILL.md) — testable Given/When/Then with stable AC ids. Knows: docs/modules, tests.
- [`spec-diff`](../../runtime/base/skills/spec-diff/SKILL.md) — covered / extension / conflict vs the active spec. Knows: docs/modules.
- [`spec-quality-review`](../../runtime/base/skills/spec-quality-review/SKILL.md) — find contradictions, gaps, TBD leaks in a spec. Knows: instructions.
- [`edge-case-detection`](../../runtime/base/skills/edge-case-detection/SKILL.md) — enumerate failure and uncommon paths. Knows: docs/modules.
- [`expert-need-detector`](../../runtime/base/skills/expert-need-detector/SKILL.md) — decide which domain experts the spec pipeline needs, from the request + S0 grounding (on by default on the graduated and full lanes; the model decides, the script validates against the roster). Knows: docs/modules, instructions.
- [`expert-notes`](../../runtime/base/skills/expert-notes/SKILL.md) — one runner skill with a lens per pickable expert: reads the brief `paqad-ai spec pipeline experts brief <role>` prints and writes request-time findings and questions. Knows: the brief, its lens.
- [`expert-synthesis`](../../runtime/base/skills/expert-synthesis/SKILL.md) — the chief architect: accepts or declines each finding, recommends a resolution per conflict, lists gaps, gives a readiness verdict. Knows: the merge, the notes, the request, the grounding.

Expert personas: the two new pickable experts [QA Engineer](../../runtime/capabilities/coding/agents/qa-engineer.md) and [User Flow Writer](../../runtime/capabilities/coding/agents/user-flow-writer.md), and the [Chief Architect](../../runtime/capabilities/coding/agents/chief-architect.md) who is never picked and runs once any expert fired. They join the nine existing review personas the `expert-notes` lenses adapt for request time.
- [Requirement Analyst](../../runtime/base/agents/requirement-analyst.md) (agent) — decompose into FR/NFR/AC/invariants. Knows: docs/modules, source, module-map.
- [Market Researcher](../../runtime/base/agents/market-researcher.md) (agent) — external benchmarks when needed. Knows: docs/modules, rag.

### Plan
- [`story-and-solution-writer`](../../runtime/base/skills/story-and-solution-writer/SKILL.md) — implementation-ready story + solution narrative. Knows: docs/modules, instructions.
- [`sequence-planner`](../../runtime/base/skills/sequence-planner/SKILL.md) — order work by global precedence (schema → contracts → … → UI). Knows: docs/modules, instructions.
- [`test-per-ac-planner`](../../runtime/base/skills/test-per-ac-planner/SKILL.md) — map each AC to the narrowest verification path. Knows: tests, docs/modules.
- [`diff-minimizer`](../../runtime/base/skills/diff-minimizer/SKILL.md) — drop scaffolding / over-build before coding. Knows: docs/modules, instructions.
- [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) — classify impact on consuming modules' surfaces. Knows: module-map, import-graph, docs/modules.
- [`rollback-safety-planner`](../../runtime/base/skills/rollback-safety-planner/SKILL.md) — executable rollback procedures for high-risk stories. Knows: instructions, docs/modules, git.
- [`performance-regression-estimator`](../../runtime/base/skills/performance-regression-estimator/SKILL.md) — pre-code perf hazards vs hot-path budgets. Knows: docs/modules, source.
- [Story Designer](../../runtime/base/agents/story-designer.md) (agent) — slice spec into dependency-ordered stories. Knows: docs/modules, source, tests, module-map.
- [Product Owner](../../runtime/base/agents/product-owner.md) (agent) — enforce scope at build time; at request time, a standing spec expert for value, scope and non-goals. Knows: docs/modules.
- [application-architect](../../runtime/capabilities/coding/agents/application-architect.md) (agent) — a standing spec expert for where a change lands in this app and what it is built from (framework piece, placement, layering, technical page). Knows: stack packs, docs/modules, instructions.
- [solution-architect](../../runtime/capabilities/coding/agents/solution-architect.md) (agent) — reuse map, patterns, contracts, trade-offs. Knows: docs/modules, source, git.
- [data-modeler](../../runtime/capabilities/coding/agents/data-modeler.md) (agent) — entities/relationships/migration plan. Knows: docs/modules, instructions.

### Implement
- [integration-architect](../../runtime/capabilities/coding/agents/integration-architect.md) (agent) — API/webhook/MCP boundaries, failure modes. Knows: source, docs/modules, module-map.
- [database-expert](../../runtime/capabilities/coding/agents/database-expert.md) (agent) — query perf, migration safety, integrity. Knows: source, docs/modules.
- [devops-engineer](../../runtime/capabilities/coding/agents/devops-engineer.md) (agent) — deployability, CI/CD, env parity. Knows: instructions, source.

### Review
- [`adversarial-review`](../../runtime/base/skills/adversarial-review/SKILL.md) — risk-first defect/coverage/assumption hunt. Knows: docs/modules, tests, source, git.
- [`test-execution-feedback-loop`](../../runtime/base/skills/test-execution-feedback-loop/SKILL.md) — smallest fix per failing test, anchored to file:line:AC. Knows: tests, source, git.
- [Adversarial Reviewer](../../runtime/base/agents/adversarial-reviewer.md) (agent) — challenge assumptions, find regressions, detect fix-loops. Knows: source, instructions, tests, git.
- [Gap Detector](../../runtime/base/agents/gap-detector.md) (agent) — missing reqs/edge cases/docs/orphans, cross-system impact. Knows: docs/modules, tests, source, traceability.
- [Final Reviewer](../../runtime/base/agents/final-reviewer.md) (agent) — confirm gates + spec + traceability, ready-for-handoff. Knows: tests, git, traceability.
- [security-auditor](../../runtime/capabilities/security/agents/security-auditor.md) (agent) — injection/auth/secrets/config scan on diff. Knows: source, docs/modules.
- [performance-analyst](../../runtime/capabilities/coding/agents/performance-analyst.md) (agent) — N+1, bloat, caching, async anti-patterns. Knows: source, docs/modules.
- [ux-ui-analyst](../../runtime/capabilities/coding/agents/ux-ui-analyst.md) (agent) — UI states, a11y, pattern consistency. Knows: docs/modules, instructions.

### Test / verify
- [Test Planner](../../runtime/base/agents/test-planner.md) (agent) — AC → test cases, stack-aware scaffolding. Knows: tests, source, docs/modules.
- [Verifier](../../runtime/base/agents/verifier.md) (agent) — ordered lint/type/test/build gates, evidence JSON, flaky quarantine. Knows: source, tests, git.

### Docs
- [`documentation-workflow`](../../runtime/base/skills/documentation-workflow/SKILL.md) — two-stage doc creation; builds module-map authority. Knows: docs/modules, module-map, traceability.
- [`documentation-sync-engine`](../../runtime/base/skills/documentation-sync-engine/SKILL.md) — route stale docs to domain maintainers. Knows: docs/modules, git.
- [`diff-doc-sync`](../../runtime/base/skills/diff-doc-sync/SKILL.md) — minimal set of docs stale from this diff. Knows: docs/modules, git.
- [`canonical-doc-sync`](../../runtime/base/skills/canonical-doc-sync/SKILL.md) — align specs/module docs/registries with shipped behaviour. Knows: docs/modules, source, git.
- [`existing-doc-checker`](../../runtime/base/skills/existing-doc-checker/SKILL.md) — scan canonical truth before writing new artifacts. Knows: docs/modules, module-map, traceability.
- [`api-doc-maintainer`](../../runtime/base/skills/api-doc-maintainer/SKILL.md) — routes/schemas/perms/errors together. Knows: docs/modules, source, git.
- [`integration-doc-maintainer`](../../runtime/base/skills/integration-doc-maintainer/SKILL.md) — events/jobs/contracts/fallbacks, both sides. Knows: docs/modules, source, git.
- [`error-catalog-maintainer`](../../runtime/base/skills/error-catalog-maintainer/SKILL.md) — error codes + recovery + registry consistency. Knows: docs/modules, source, git.
- [`glossary-maintainer`](../../runtime/base/skills/glossary-maintainer/SKILL.md) — shared terminology, drift detection. Knows: docs/modules, traceability.
- [doc-maintainer](../../runtime/capabilities/coding/agents/doc-maintainer.md) (agent) — detect drift, update only what changed. Knows: docs/modules, source, git.

### Module-map + health
- [`module-attribution-extractor`](../../runtime/base/skills/module-attribution-extractor/SKILL.md) — deterministic module refs from the prompt, collision detect. Knows: module-map, source.
- [`module-attribution-inferencer`](../../runtime/base/skills/module-attribution-inferencer/SKILL.md) — ranked hypothesis when the extractor finds nothing. Knows: module-map, source.
- [`module-map-reconciler`](../../runtime/base/skills/module-map-reconciler/SKILL.md) — drift between the map and the source tree. Knows: module-map, source, docs/modules.
- [`module-health-rollup`](../../runtime/base/skills/module-health-rollup/SKILL.md) — attribute coverage/tests to modules. Knows: module-map, tests, source.
- [`module-health-update`](../../runtime/base/skills/module-health-update/SKILL.md) — refresh the whole module graph in one pass. Knows: module-map, tests, source.

### Rules-as-scripts
- [`rule-analyzer`](../../runtime/base/skills/rule-analyzer/SKILL.md) — classify rules verifiable/heuristic/unverifiable. Knows: instructions, source.
- [`rule-editor`](../../runtime/base/skills/rule-editor/SKILL.md) — add/edit/remove/downgrade rules with stable ids. Knows: instructions.
- [`rule-script-generator`](../../runtime/base/skills/rule-script-generator/SKILL.md) — author `.mjs` checks validated against fixtures. Knows: instructions, source.
- [`rule-script-reconciler`](../../runtime/base/skills/rule-script-reconciler/SKILL.md) — detect rules-as-scripts drift. Knows: instructions, source.
- [`rule-script-runner`](../../runtime/base/skills/rule-script-runner/SKILL.md) — execute registered scripts diff-scoped in checks. Knows: instructions, source.

### Security (pentest workflow + review)
[`stride-threat-model`](../../runtime/capabilities/security/skills/stride-threat-model/SKILL.md),
[`business-logic-abuse-review`](../../runtime/capabilities/security/skills/business-logic-abuse-review/SKILL.md),
[`auth-mechanism-review`](../../runtime/capabilities/security/skills/auth-mechanism-review/SKILL.md),
[`input-validation-review`](../../runtime/capabilities/security/skills/input-validation-review/SKILL.md),
[`cryptographic-review`](../../runtime/capabilities/security/skills/cryptographic-review/SKILL.md),
[`permission-boundary-review`](../../runtime/capabilities/security/skills/permission-boundary-review/SKILL.md),
[`rate-limiting-review`](../../runtime/capabilities/security/skills/rate-limiting-review/SKILL.md),
[`logging-monitoring-review`](../../runtime/capabilities/security/skills/logging-monitoring-review/SKILL.md),
[`dependency-advisory-triage`](../../runtime/capabilities/security/skills/dependency-advisory-triage/SKILL.md),
[`runtime-surface-probing`](../../runtime/capabilities/security/skills/runtime-surface-probing/SKILL.md),
[`retest-verification`](../../runtime/capabilities/security/skills/retest-verification/SKILL.md),
plus the base skill [`finding-normalizer`](../../runtime/base/skills/finding-normalizer/SKILL.md)
and the [security-auditor](../../runtime/capabilities/security/agents/security-auditor.md) agent.
Backed by [`pentest-engine`](pentest-engine/index/summary.md). Knows: docs/modules, source, tests.

### UI / design (design-test workflow)
[`design-system-coverage`](../../runtime/capabilities/coding/skills/design-system-coverage/SKILL.md),
[`token-conformance-review`](../../runtime/capabilities/coding/skills/token-conformance-review/SKILL.md),
[`component-conformance-review`](../../runtime/capabilities/coding/skills/component-conformance-review/SKILL.md),
[`state-coverage-review`](../../runtime/capabilities/coding/skills/state-coverage-review/SKILL.md),
[`accessibility-review`](../../runtime/capabilities/coding/skills/accessibility-review/SKILL.md),
[`responsive-review`](../../runtime/capabilities/coding/skills/responsive-review/SKILL.md),
[`motion-review`](../../runtime/capabilities/coding/skills/motion-review/SKILL.md),
[`copy-and-ia-review`](../../runtime/capabilities/coding/skills/copy-and-ia-review/SKILL.md),
[`design-system-sync`](../../runtime/capabilities/coding/skills/design-system-sync/SKILL.md),
[`ui-doc-maintainer`](../../runtime/capabilities/coding/skills/ui-doc-maintainer/SKILL.md),
[`user-flow-generation`](../../runtime/capabilities/coding/skills/user-flow-generation/SKILL.md),
[`ux-state-machine`](../../runtime/capabilities/coding/skills/ux-state-machine/SKILL.md),
[`ux-heuristic-evaluation`](../../runtime/capabilities/coding/skills/ux-heuristic-evaluation/SKILL.md),
[`ux-design-research`](../../runtime/capabilities/coding/skills/ux-design-research/SKILL.md).
Knows: design-system docs, source, tests.
The workflow's scripts live in `runtime/scripts/design/`. `scan-tokens.sh` finds the
token-conformance-review scanner relative to its own location, because an onboarded project's
working directory has no top-level `runtime/`. A missing input (no snapshots, no Playwright, no
axe) is recorded as a blocked check rather than failing the run, so the workflow continues with
static evidence. `retest.sh` carries the source sidecar into the artifact dir so finding ids are
preserved, and runs the live phase only when `DESIGN_TEST_TARGET_URL` is set. The shell scripts
use the `${arr[@]+"${arr[@]}"}` idiom because expanding an empty array under `set -u` is fatal on
Bash 3.2, the macOS default.

### Codebase health (codebase-health workflow)
The deterministic `paqad-ai health run` verb finds dead code, unused/risky/deprecated
packages, leaked secrets, duplication, stale docs, and AI slop — every finding with proof,
a plain-words reason, and a suggested action, split honestly into Proven vs Needs-judgment.
`paqad-ai health retest` reclassifies prior findings by their stable `HL-` id. Rules:
[`codebase-health`](../../runtime/capabilities/coding/rules/codebase-health.md),
[`health-retest`](../../runtime/capabilities/coding/rules/health-retest.md).
Backed by [`codebase-health`](codebase-health/index/summary.md). Knows: code-knowledge index,
dependency inventory, docs/modules, source.

### Site map (site-map workflow — behind the `site_map` flag, off by default)
The map is a single AI-authored YML at `docs/site-map/` (`app-map.yaml`, `journeys/*.journey.yaml`,
`answers.yaml`) — the one site-map location, which the dashboard's Site map area renders
statically with no model call at view time. The deterministic `paqad-ai sitemap run` verb (the
same engine behind the area's Run) extracts the application's surfaces (pages, screens,
endpoints, CLI commands), reconciles them against the stored map, runs Tier-A verification
(evidence resolution, cross-reference integrity, graph invariants, trust honesty), and stamps
each element's earned trust tier plus the map-vs-code freshness back into the stored map — no
timestamped report dumps and no generated views; the run's findings live in its evidence bundle
under `.paqad/site-map/runs/`. A re-run (`site-map-retest`) is the same verification run again.
`paqad-ai sitemap journey confirm|reject <id>` is the human sign-off that turns a proposed journey
into a confirmed one (or removes it), recorded on the audit ledger. The
[`SiteMapFreshnessGate`](../../src/verification/gates/site-map-freshness.ts) keeps a
feature-development change from reaching "Safe to merge" while the stamped freshness says the map
drifted from the code (inert when the flag is off). Skills:
[`site-map-readiness`](../../runtime/capabilities/coding/skills/site-map-readiness/SKILL.md),
[`surface-extraction`](../../runtime/capabilities/coding/skills/surface-extraction/SKILL.md),
[`surface-modeling`](../../runtime/capabilities/coding/skills/surface-modeling/SKILL.md),
[`transition-tracing`](../../runtime/capabilities/coding/skills/transition-tracing/SKILL.md),
[`guard-inference`](../../runtime/capabilities/coding/skills/guard-inference/SKILL.md),
[`site-map-assembly`](../../runtime/capabilities/coding/skills/site-map-assembly/SKILL.md),
[`map-verification`](../../runtime/capabilities/coding/skills/map-verification/SKILL.md),
[`site-map-gap-analysis`](../../runtime/capabilities/coding/skills/site-map-gap-analysis/SKILL.md),
[`journey-synthesis`](../../runtime/capabilities/coding/skills/journey-synthesis/SKILL.md),
[`site-map-maintainer`](../../runtime/capabilities/coding/skills/site-map-maintainer/SKILL.md),
[`site-map-retest`](../../runtime/capabilities/coding/skills/site-map-retest/SKILL.md). Rules:
[`site-map`](../../runtime/capabilities/coding/rules/site-map.md),
[`site-map-retest`](../../runtime/capabilities/coding/rules/site-map-retest.md). Roles:
[app-cartographer](../../runtime/capabilities/coding/agents/app-cartographer.md) (draws + verifies
the map),
[journey-designer](../../runtime/capabilities/coding/agents/journey-designer.md) (proposes
journeys; humans confirm). Backed by `src/site-map`. Knows: code-knowledge index, route/command
scan, module-map, source.

#### Why the site-map engine works the way it does

The reasons below are not obvious from the code, grouped by file in `src/site-map/`.

- **Pure core, one I/O seam.** `assemble.ts`, `draft.ts`, `extraction.ts`, `transitions.ts`,
  `trust.ts`, `freshness.ts`, `verification.ts` and `laravel-sources.ts` do no I/O, so every branch
  is tested with fixtures. `gatherer.ts` does all the file reading and shelling out and is
  excluded from coverage. `run.ts` takes the gatherer as a required argument (the CLI verb
  supplies it), unlike codebase-health, so the orchestrator is fully exercised offline. A pointer
  the gatherer did not resolve reads as resolved, so a missing resolution never raises a phantom
  finding or inflates staleness.
- **Gaps are visible, never silent passes.** An unavailable extractor, items it found but could
  not trace to source, edges that resolve to no surface, a map with no transitions, and a run with
  no map are each recorded as a blocked check. A run is `safe` only when a stored map records
  navigation and nothing was blocked; the exit code is decided separately.
- **Evidence contract.** Every extractor's evidence `file` is a project-relative path that exists,
  so verification can resolve it; a command such as `php artisan route:list` only goes in the
  `note`. Artisan says what is registered but not where, so each record is traced back to source
  (PSR-4 from composer, the controller method line, the route-file declaration). A route file
  pointer is only cited when exactly one static declaration matches, because a wrong pointer is
  worse than none. Artisan commands not declared in project source are framework or package
  built-ins and are skipped. Jobs and mailables have no artisan listing, so they always come from a
  module-aware static class scan. The artisan invocation is read from the profile's commands
  (Sail, docker compose with `-T` since there is no terminal, or host PHP); a leftover placeholder
  or a shell operator blocks the run. A site-map run never rewrites the profile.
- **Preflight never boots the app.** The Laravel requirement checks only that the runner is
  present (`--version`), never runs `artisan route:list`, because running it boots the user's app,
  which is the choice the person makes first.
- **Transitions.** A transition is recorded only for a real navigation call, never a bare href,
  an import or a path-like string. Framework calls are `high` confidence, convention matches
  (`view('name')`, CLI dispatch helpers) `low`. Targets are matched to a surface's `entry.value`
  exactly, with no normalising; an unmatched target is dropped and counted. A bare `route('name')`
  builds a URL and is not navigation.
- **Trust and freshness.** A trust tier is earned, never taken on the model's word: a resolving
  anchor earns `proven-in-code`, a broken anchor collapses to `unverified`, and a missing anchor is
  capped at `inferred`. Trust and freshness read the same resolutions, gathered once, so they can
  never disagree. Freshness is counts only, never a timestamp, and both stamps return the same
  object when nothing moved, so a steady map over steady code is left byte for byte unchanged and
  the dashboard renders it with no work at view time. Journeys are not stamped; they have no code
  anchor.
- **Creation answers.** A persisted answer is reused only when a person decided it and its code
  anchors are unchanged; a default is always offered again. The category and anchors of a recorded
  decision are re-derived from the map, never taken from agent text. Provenance stamps only ever
  raise a surface: `agent` (a model or default guess) ranks below `static` and `convention`, which
  is deliberately not the declaration order of the derivations list. Only surface-deciding
  categories may stamp a surface, and only when the answer's anchors cover the surface's whole
  anchor set. A preflight question puts the probe outcome in its id, so the answer is re-asked when
  the probe result changes.
- **Drafting.** The skeleton carries only what extraction proved and invents no transitions,
  journeys or actors. A trailing `group:ungrouped` unit exists because a project whose extractor
  attributes no modules would otherwise seed an empty progress store that could never resume. The
  merge is additive: a surface the extraction no longer produces is kept, and SM-REMOVE reports it.
- **Stores.** Every writer validates before writing and writes atomically (temp file and rename);
  every reader treats a missing, corrupt or invalid file as absent. The progress store uses a
  unique temp path per write (pid and a counter) and on load resets every `writing` unit and
  deletes its half-written file. `status` never writes. `layout-store.ts` allows only slug-shaped
  district ids and builds the result from validated pairs onto a null-prototype object, so a
  request key can never reach `Object.prototype`.
- **Small choices.** Finding ids hash the finding's meaning, so the same defect keeps its id
  across runs. SHA-256 here is a stable content key, not security. The ESC character in
  `extraction.ts` is built at runtime so no control character appears in source (the
  `no-control-regex` lint). The store reads a file directly instead of checking it exists first,
  to avoid the race.

### Data / incident
[`database-design-review`](../../runtime/capabilities/coding/skills/database-design-review/SKILL.md),
[`index-optimization`](../../runtime/capabilities/coding/skills/index-optimization/SKILL.md),
[`query-pattern-analysis`](../../runtime/capabilities/coding/skills/query-pattern-analysis/SKILL.md),
[`root-cause-analysis`](../../runtime/capabilities/coding/skills/root-cause-analysis/SKILL.md).
Knows: docs/modules, source, module-map.

### Content (content workflow)
[`content-planner`](../../runtime/capabilities/content/skills/content-planner/SKILL.md),
[`content-writer`](../../runtime/capabilities/content/skills/content-writer/SKILL.md),
[`content-reviewer`](../../runtime/capabilities/content/skills/content-reviewer/SKILL.md),
[`script-writer`](../../runtime/capabilities/content/skills/script-writer/SKILL.md),
[`seo-optimizer`](../../runtime/capabilities/content/skills/seo-optimizer/SKILL.md),
[`style-enforcer`](../../runtime/capabilities/content/skills/style-enforcer/SKILL.md).
Knows: instructions.

---

## 4. Where whole-codebase consciousness lives

This is the substrate that makes the AI aware of the project beyond the file it is
editing. For each engine: how strong it is today, and whether it is **wired into
the coding flow** or **sits to the side** (advisory, lane-gated, or opt-in).

| Engine | What it gives the AI | Strength | Wired in, or to the side |
| --- | --- | --- | --- |
| [Module-Map](module-map-engine/index/summary.md) (`src/module-map`) | Which business modules and files exist, and which module a change belongs to | Strong, **structural** (existence), not behavioural | **Wired in** — gates `planning`; attribution forces every change to declare its module |
| [Traceability](traceability-engine/index/summary.md) (`src/traceability`) | A reality-rebuilt promise ↔ code ↔ test map; orphans and untested promises via import-graph BFS | Strong as a map | **Wired in**: the change map (frozen spec automated criteria against the tests changed on the branch) is built at Stop verification and at `checks run`, and the `ac-test-mapping` gate reads it. The whole-tree build is not run in production |
| Reuse-first planning ([`diff-minimizer`](../../runtime/base/skills/diff-minimizer/SKILL.md), [`existing-doc-checker`](../../runtime/base/skills/existing-doc-checker/SKILL.md), [solution-architect](../../runtime/capabilities/coding/agents/solution-architect.md)) | Stops the change from rebuilding what exists and from over-building before code is written | Reuse map + step classification | **Wired in** — named in the enforced planning-stage contract; the reuse reflex fires on every lane, the diff-minimizer/existing-doc-checker procedures on graduated/full |
| [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) | Classifies impact on consuming modules (breaking / silent-shift / additive) | Real consumer-graph reasoning | **Wired in, lane-gated** — named in the enforced planning contract on graduated/full multi-module changes. A fast-lane edit gets none of it |
| [RAG / context](hybrid-rag/index/summary.md) (`src/rag`, `src/context`) | Retrieval of the most relevant existing code within a token budget | Present | **Opt-in** at onboarding; augments retrieval, does not gate |
| [Gap Detector](../../runtime/base/agents/gap-detector.md) | Cross-system impact, missing edge cases, orphans | Moderate-to-strong | **Wired into review** — catches misses after the fact, not during writing |
| Review evidence digest (`src/review-digest`) | The hard facts review used to lack: rule findings, duplication, check verdicts, failing gates — plus the blind spots nothing checks | Deterministic, zero model tokens, four cached sources | **Wired in** — named in the enforced review-stage contract, and the review gate fails when a deterministic high-severity row is never cited by file:line |
| [Verification gates](verification/index/summary.md) (`src/verification`) | 16 contract-driven, language-agnostic land/block checks | Strong | **Wired in twice** — in-pipeline and at the git/CI backstop |
| [Decision Pause](decision-pause-contract/index/summary.md) | A hard stop for human judgment at flagged junctions | Strong control point | Wired in; depends on the AI honouring it plus the PreToolUse hook |
| [Evidence Ledger](evidence-ledger/index/summary.md) (`src/evidence`) | An append-only record of what every gate and engine produced | The connective tissue | Wired in; a record, not an enforcer |
| [HUD snapshot](feature-evidence/index/summary.md) (`src/hud`) | One per-session file, `.paqad/session/hud/<session>.json`, saying where the change stands, built only from paqad's own records, plus the in-session receipt and verdict | A view, zero model tokens | **Wired in, never decides**: the paqad verbs and the stage and Stop hooks refresh it after their decision is final; a failed write is logged, never a changed verdict. Read with `paqad-ai status --hud`. On Claude Code the plugin's mod (`runtime/claude-plugin/mod/`, Parts 8 and 9) draws it as a band above the prompt and answers `/paqad`; the mod only shows, every check stays a hook, and it stands down when the `hud_view` config key is off, the project was never onboarded, the session is remote, paqad is off, or Claude Code is older than 2.1.301 |
| Change-shape metrics (`src/change-metrics`) | Two per-change numbers — duplication on new code and cross-file reuse rate — so "less, better code" is measurable, not a slogan | Deterministic, zero model tokens; folds over the duplication + code-knowledge caches | **Wired in** — computed at the completion seam for feature-development changes, shown on the end-of-change receipt, trended on the dashboard, and folded into the SIEM export. Observed, not gated |
| Stage isolation (`src/stage-isolation`) | Each mandatory stage runs in its own fresh host subagent, with the evidence bundle as the only shared memory, so later stages stop re-carrying earlier stages' history | Structural context economy; token counts recorded per stage agent as `stage-agent` rows in `stage-evidence.jsonl` | **Core engine, lane-gated; expected-and-detected, not pre-enforced** — no config knob; runs on Claude Code and Codex, graduated/full lanes only (the fast lane and non-subagent hosts never dispatch a stage agent). Install **and update** write six `paqad-<stage>` agents at user scope (plus the two High Table agents, `paqad-expert` and `paqad-chief-architect`, which are never stages and add no `stage-agent` row), a record-only `SubagentStop` hook logs each stage agent's `stage-agent` row, and the in-flight fork guard refuses to mint a third bundle on one branch. Each stage subagent proves its own cold framework load via an `agent_id`-keyed entry sentinel. Every stage-evidence row carries the `agent` that wrote it (`orchestrator` or `paqad-<stage>`). Nothing blocks an inline edit before it happens — the guarantee is detection at end-of-change: on a graduated/full lane on a subagent-capable host a bundle with no `stage-agent` rows **fails** the completeness gate, and an **unresolved** lane there reads **Inconclusive** ("not classified — isolation not verified") rather than a clean green. The lane the check reads is the recorded `feature.json` lane; it is operator-correctable (`paqad-ai lane set <lane>`) and **monotonic** (only ever rises), so a small follow-up can never relabel a large build "fast", and a bare ticket/URL prompt leaves it unresolved-pending-read |

**The honest summary.** The always-on consciousness is the entry-gate +
module-map/attribution + verification gates, and the
reuse-first reflex that fires in planning on every lane, and the
review digest, whose deterministic rows the review gate makes non-ignorable. The *richest* cross-module
reasoning (the impact scanner, the full traceability universe scan, RAG) and the
diff-minimizer/existing-doc-checker procedures are **lane-gated or opt-in**, so they
are present but not guaranteed on every edit, and are most absent on fast-lane
changes.

---

## 5. Language-agnostic reality

**Genuinely language-neutral** (works for Go, C++, React alike): stack detection
(lockfile patterns), the entry-gate and hooks, classify/route, the module-map
reconciler and source-root discovery (glob-based), traceability (file paths +
import edges + structured metadata), the 16 verification gates, decision-pause,
the evidence ledger, and most reasoning skills (scope, sequencing, edge-cases,
STRIDE, abuse-cases, permission boundaries, accessibility, content, RCA).

**Quietly ecosystem-bound** (lean Node / SQL / web and need per-stack guidance
elsewhere): rules-as-scripts authoring (reads `tsconfig`/ESLint, emits Node
`.mjs`), module-health parsers (a fixed set of coverage/test formats),
`test-execution-feedback-loop`, several security and performance skills that read
language-specific source idioms, and the API/integration/error doc maintainers
that extract from language-specific patterns (though they write neutral docs).

The pattern: the orchestration, contracts, and structural awareness are
universal; the leaf-level "read this source idiom" steps are where ecosystem
assumptions live.

---

## 6. Where each concern lives (pointer table)

| Concern | Start here |
| --- | --- |
| Cross-adapter entry | [`adapter-onboarding`](adapter-onboarding/index/summary.md), [`CLAUDE.md`](../../CLAUDE.md), `.paqad/framework-path.txt` |
| Stack detection | [`stack-detection-engine`](stack-detection-engine/index/summary.md), `docs/instructions/stack/overview.md` |
| Routing + capabilities | [`agent-routing`](agent-routing/index/summary.md), [`capability-model`](capability-model/index/summary.md), `src/core/capabilities.ts` |
| Workflow execution | [`workflow-engine`](workflow-engine/index/summary.md), [`feature-development-workflow`](feature-development-workflow/index/summary.md) |
| Skill / agent loading | [`skill-runtime`](skill-runtime/index/summary.md), [`agent-runtime`](agent-runtime/index/summary.md) |
| Module authority | [`module-map.yml`](../instructions/rules/module-map.yml), [`module-map-engine`](module-map-engine/index/summary.md) |
| Whole-product impact | [`traceability-engine`](traceability-engine/index/summary.md), [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) |
| Targeted retrieval | [`context-intelligence`](context-intelligence/index/summary.md), [`hybrid-rag`](hybrid-rag/index/summary.md) |
| Pause for a human | [`decision-pause-contract`](decision-pause-contract/index/summary.md) |
| Land / block a change | [`verification`](verification/index/summary.md), [`quality-ratchet`](quality-ratchet/index/summary.md) |
| Proof + provenance | [`evidence-ledger`](evidence-ledger/index/summary.md) |
| Per-prompt mechanics | [`prompt-life-cycle.md`](prompt-life-cycle.md) (research note, deeper stage-by-stage detail) |

---

## 7. How to keep this accurate

This overview is intentionally thin: it is a map, not a copy. It goes stale when
the *shape* of the system changes, not when an implementation detail does. Update
it in the same change that:

- adds, removes, or renames a stage in
  [`feature-development.yaml`](../instructions/workflows/feature-development.yaml);
- adds, removes, or renames a skill under `runtime/**/skills/` or an agent under
  `runtime/**/agents/` (update §3);
- adds or changes a consciousness engine in §4 (module-map, traceability, impact
  scanner, RAG, gates, decision-pause, evidence);
- changes which capability gates a skill or agent.

The enforcing rule is
[`docs/instructions/rules/_shared/onboarded-overview-maintenance.md`](../instructions/rules/_shared/onboarded-overview-maintenance.md).
