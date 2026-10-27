# Adapter Onboarding (LLM platform entry files)

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `adapter-onboarding`

## Purpose

Generates the thin entry file each external LLM agent platform reads on
startup. All entry files point back to the same shared instruction
bundles under `docs/instructions/` and the framework runtime, so one
onboarding configures every supported platform.

## Source Footprint

- `src/adapters`
- `src/onboarding/file-writer.ts`

## Features

- [Claude Code (CLAUDE.md)](../features/claude-code/business.md)
- [Codex CLI (AGENTS.md)](../features/codex-cli/business.md)
- [Google Antigravity (ANTIGRAVITY.md)](../features/antigravity/business.md)
- [Gemini CLI (GEMINI.md)](../features/gemini-cli/business.md)
- [JetBrains Junie](../features/junie/business.md)
- [Cursor](../features/cursor/business.md)
- [GitHub Copilot](../features/github-copilot/business.md)
- [Windsurf](../features/windsurf/business.md)
- [Continue](../features/continue/business.md)
- [Aider (config-only)](../features/aider/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code in `src/adapters/`.

- **Entry files (`shared/base-adapter.ts`, `shared/framework-fallback-clause.ts`).** The entry file
  is a lean stub pointing at `AGENT-BOOTSTRAP.md`; the load order and the narration and
  decision-pause contracts live only in the bootstrap, behind its enablement check. The fallback
  clause is generated once in core and is byte-identical for every host (a test checks this),
  because on a hook-less IDE the entry file is the only thing that can stop an absent or disabled
  paqad reading as "this tool broke my editor". It is not a `##` heading so it stays within the
  closed entry-file heading list.
- **Per-machine hook files.** Claude `settings.json`, Codex `hooks.json` and Gemini `settings.json`
  carry an absolute, machine-specific `node "<abs>"` command, so the adapters that wire real hooks
  also write a nested `.gitignore` in their config folder; committing those files would break a
  teammate or CI with another home directory or OS. paqad owns the `.gitignore` inside the folder it
  manages and never edits the project root one. The base `installHooks` sidecar goes to a
  paqad-internal path so it can never overwrite the file the host really runs. paqad writes no MCP
  config at any host path, because those files belong to the tools that read them and older versions
  overwrote servers teams had configured; Claude's `.mcp.json` is only read (by `doctor`).
- **Hook commands (`shared/paqad-hooks.ts`).** A command is `node "<abs>/hooks/<file>"`: Windows
  shells do not expand `~` and ignore shebangs and the executable bit, and `node` is always present
  for a Node CLI. The path is recomputed from the local home on every generation. One chain
  definition serves Claude Code and Codex, mapped to each host's event names and mutating-tool
  matcher (Codex matches `tool_name` with a regex, so `^apply_patch$` is anchored); the same scripts
  run on both and the host is passed as one argv. The default host, `claude-code`, never gets that
  argv, so Claude's generated config stays byte-identical. Event order is fixed (PreToolUse,
  UserPromptSubmit, SessionStart, Stop, SubagentStart on Claude Code only, then SubagentStop
  last) so a re-onboard is
  byte-stable. The stage writer is a non-blocking writer ordered after the entry gate; the stage
  marker recorder runs before the completion backstop so planning, specification and review markers
  are in the ledger when it folds the change.
- **Fail closed on Claude.** The three pre-mutation edit gates carry `onFailure: "block"` and a 10
  second timeout, so a gate that cannot start, times out, exits oddly or prints invalid output blocks
  the edit. This is rendered for Claude Code only (2.1.295 and later); Codex output is unchanged.
- **SubagentStop.** It always renders because stage isolation has no knob, and it costs nothing
  unless a `paqad-<stage>` agent runs. The matcher accepts `paqad-<stage>` (npm) and
  `paqad:paqad-<stage>` (plugin) and never a user's own or built-in subagents. It never blocks,
  since blocking on SubagentStop is undocumented.
- **SubagentStart (Claude Code only).** Codex has no such event, so a host with no native name for
  an event simply gets no entry for it, and Codex output is unchanged. The matcher
  (`PAQAD_STAGE_HELPER_MATCHER`) accepts only the six stage helpers, with or without the
  `paqad:` plugin prefix, and never `paqad-expert`, `paqad-chief-architect` or a user's own
  agents. The entry carries a 10 second timeout and no `onFailure`, so it can never block; the
  plugin chain renders the same entry with the same matcher and timeout.
- **The plugin chain.** Commands are rooted at the literal `${CLAUDE_PLUGIN_ROOT}/runtime`, which the
  host substitutes at hook time. A plugin-only SessionStart bootstrap runs first (it re-points the
  framework link and sets the PATH the other hooks rely on), `silent-update.mjs` is left out because
  the plugin channel updates itself, and no fail-closed policy is emitted yet: plugin hooks fail open
  until manual sign-off. When onboarding runs under the plugin, the npm chain is not written, so a
  repo has exactly one hook chain.
- **The renderer (`shared/native-hook-config.ts`).** One renderer writes every host's hook file.
  It is idempotent and non-destructive: the existing file is read tolerantly (single read, missing
  or unparseable means empty), keys outside the managed `hooks[event]` are untouched, retired
  commands are pruned before merging, existing groups come first and a paqad command already present
  is not added again. Retired hooks with no replacement (the old rule-script hook, the Codex
  record-only completion hook) are pruned by basename in any form, so the replacement never fires
  beside them; exact legacy strings (the old `.sh` and bare-path forms) are pruned too. Gemini keeps
  the single record-only `AfterAgent` hook, which always exits 0 and stays silent so its host never
  halts or retries.
- **Attribution.** Claude Code adds a `Co-Authored-By` trailer by default, which makes a git host list
  the AI vendor as a contributor. Under the `strip` policy the adapter writes the current
  `attribution` object (never the deprecated `includeCoAuthoredBy`), fills each sub-key only when it
  is absent so a team's own value survives, and keeps keys paqad does not know. Aider rewrites the
  git author and committer by default, so its three attribution keys are turned off together; the
  `.aider.conf.yml` merge uses the YAML document API to keep the team's comments, order and values,
  and a corrupt file is replaced with a valid one instead of failing onboarding. Nothing is written
  under the `keep` policy.
- **JetBrains AI Assistant.** It auto-applies every `.aiassistant/rules/*.md` and has no hooks, so it
  is a rules-only advisory adapter. MCP is off because the IDE configures MCP servers in its own
  settings, not from a project file.

## Why the runtime hooks work the way they do

The host hooks under `runtime/hooks/` are plain `.mjs` and `.sh` files, because a hook has to run
before any build is resolvable and on every platform. These are the reasons the code does not
state on its own.

### Shared rules for every hook

- **Entry guard.** Every hook decides whether it is the process entry point through
  `lib/direct-entry.mjs`, which compares real file URLs. The host runs hooks through the
  symlinked install (`~/.paqad-ai/current`, or the plugin's runtime), macOS aliases `/tmp` to
  `/private/tmp`, and Windows and paths with spaces never match a raw `argv[1]` compare, so a raw
  compare would make the hook silently do nothing. A guard test keeps the raw form out.
- **Stdin.** Hooks drain stdin before acting so the process never hangs on the pipe, and resume
  the stream so an already closed stdin still lets the hook run with an empty payload.
- **Off means off.** When paqad is disabled (by `PAQAD_DISABLED` or the layered `paqad_enable`),
  every hook is a pure no-op that prints and writes nothing, checked before any blocking logic.
  An injected `[paqad]` line would contaminate the off arm of an A/B comparison.
- **Failure handling.** The pre-mutation edit gates (agent entry, decision pause, the capability
  gate's pre-mutation seam) fail closed: an unexpected error blocks the edit with exit 2 and the
  one line from `lib/gate-failure.mjs` that points at `paqad-ai doctor`. `onFailure: "block"` in
  the rendered host config covers what a script never sees (node missing, a moved file, a
  timeout). Every other hook soft-fails, but never silently: `lib/hook-log.mjs` appends one line
  per failure to `.paqad/logs/hooks.log`. A swallowed import error once hid a total routing outage
  for weeks, so a bare empty catch is not acceptable where a failure matters. Logging itself never
  throws, since the host path matters more than the log line.
- **Future schema.** A project set up by a newer paqad makes the engine throw a schema-version
  error. A hook then logs one line and exits 0; `doctor` and the dashboard point at the update.
  The error is matched by code and name so a dist-less hook need not import the class.
- **Project root.** `resolveProjectRoot` walks up from the payload's `cwd` to the nearest
  `.paqad/`, because in a worktree session Claude Code sets `CLAUDE_PROJECT_DIR` to the main
  checkout and only the payload `cwd` names the worktree. With no payload it falls back to
  `CLAUDE_PROJECT_DIR`, `PAQAD_PROJECT_ROOT`, then the current directory. The shell copy in
  `lib/paqad-disabled.sh` does the same walk.
- **Host argument.** Hooks that serve more than one host take the host as one argument
  (default `claude-code`, omitted so Claude's command stays byte-identical; Codex passes
  `codex-cli`), so rows are attributed to the host that ran.
- **After the decision.** HUD and cost refreshes (`lib/hud-snapshot.mjs`, `lib/cost-refresh.mjs`)
  run only after a hook's exit code is computed and its output written. They only rewrite their
  own files, stand down wherever the hook stands down, and never reject, so they cannot change
  what the hook decided. The capability gate refreshes the HUD only at the completion seam, since
  pre-mutation runs before every edit and records nothing the snapshot shows.
- **No user-facing system messages.** Claude Code renders a top-level `systemMessage` from Stop
  and PreToolUse hooks as literal "Stop says:" and "PreToolUse says:" lines, which duplicated the
  narration the agent speaks and leaked framework prose into chat. Hooks write the ledger and stay
  quiet; the agent speaks each `▸ paqad` line itself. A strict violation still reaches the model
  on stderr with exit 2. The one model-facing exception is the first frontend edit's visual
  evidence reminder, sent as PreToolUse `additionalContext` on Claude Code.

### Entry gates and sentinel

- **`lib/agent-entry-sentinel.mjs`.** Both entry gates share this module so they agree on what a
  fresh sentinel means. Staleness compares mtimes with a strict "newer than" (equal is not newer)
  against the entry file, `.paqad/framework-path.txt` and, recursively, only the instruction
  folders the entry load reads: `docs/instructions/{stack,design-system,workflows}`, the exported
  `LOADED_INSTRUCTION_DIRS`. paqad's own stages write rules, the rule-script map, registries and
  tech-debt items under `docs/instructions/` during normal work, and those files are not part of
  the entry load (the rule contract has its own record, `rules-loaded.json`), so a change there
  never stales the sentinel. The router writer in `src/onboarding/agent-bootstrap-writer.ts`
  renders its always-load list from a TypeScript copy of the same list, and a unit test fails when
  the two differ, because a hook cannot import TypeScript source. A sentinel stale on the entry
  file or the framework path is deleted so the next run re-blocks with the full load. A sentinel
  stale on a loaded instruction file is kept and stays stale by mtime until it is restamped: the
  entry gate and the capability gate's entry probe run side by side, and deleting it made the
  second one ask for a full reload instead of naming the changed files. On
  the main thread the sentinel lives at `.paqad/.agent-entry-loaded.d/<session id>`, so a
  SessionStart in another session of the same checkout cannot delete it; the single legacy file is
  used only when the payload has no session id. Inside a subagent the payload carries the parent's
  `session_id` and a distinct `agent_id`, so the marker is keyed on the agent id under
  `.paqad/session/agent-entry/`, and a stage subagent must prove its own cold load. Ids are reduced
  to `[A-Za-z0-9_-]`, so an odd id cannot escape its directory or use a character Windows forbids.
  A failed stamp just re-blocks, which is the safe direction.
- **`agent-entry-gate.mjs` (PreToolUse).** No code changes until the entry file, the framework and
  the instructions are loaded. A write of the sentinel itself, of a per-agent marker or of a
  per-session sentinel is exempt, otherwise the gate's own remedy ("write the sentinel") would be
  blocked. The edited paths come from the shared extractor so a Codex `apply_patch` that writes the
  sentinel is exempt too. Inside a subagent, writing the base sentinel is promoted into that agent's
  marker, and on the main thread a write of the legacy file still clears this session's own gate.
  The directive names the exact file this session is checked against; the subagent line is only
  appended when an agent id is present so the shared step text still matches the prompt gate.
  When only loaded instruction files changed, the block skips the full load and names them
  instead: `[paqad] Blocked: <n> instruction file(s) changed since you loaded them.`, then
  `[paqad] Read them, then write <marker> and retry:` and one line per file, project-relative with
  forward slashes, at most 10 plus `and N more`. A missing marker, a changed entry file and a
  changed `framework-path.txt` keep the full-load text. Every block appends one line to
  `.paqad/logs/hooks.log`, `agent-entry-gate block reason=<missing|stale:entry-file|stale:framework-path|stale:docs-instructions> agent=<agent or session id> files=<n>`,
  so refusals can be counted by cause. The line holds only the reason, the id and the count, never
  a path or prompt text.
- **`agent-entry-prompt-gate.mjs` (UserPromptSubmit).** When the framework is not loaded it emits
  only the load directive and suppresses the `[paqad-context]` block, so the one instruction that
  must come first owns the top of context. It still routes the prompt first, writing the
  per-session workflow state, so a read-only first turn is classified and the Stop backstop does
  not blame inherited dirty files on it; the route line is dropped in that branch. Once loaded, all
  pieces are buffered and emitted once under the host's 10,000-character output cap: the route line
  and the nudge stay whole and only the context body is trimmed. The context artifact is shared by
  every session in the checkout, so a prompt routed to anything but feature development drops the
  rule sections. The soft mode is the default because a hard exit 2 on UserPromptSubmit erases the
  user's prompt, so the model could never load; the PreToolUse gate is the real block. The
  background context refresh fires after routing with the session id, so the worker reads this
  session's route. A bare `paqad-ai` call from the hook would resolve the shared cache file, so the
  session id is passed explicitly. Codex reads a UserPromptSubmit hook's JSON output, so its text
  rides the `additionalContext` envelope; Claude keeps plain stdout.
- **`lib/agent-entry-directive.mjs`.** The two gates used to hand-copy the load steps and the copy
  drifted, so the steps live in this one dist-less module (hooks cannot import the TypeScript
  writers). The instruction folders in step 4 come from `LOADED_INSTRUCTION_DIRS` in the sentinel
  module, the same list staleness checks. Both gates only fire when paqad is on, so the directive states that as fact. It tells
  the agent to read files with its file-read tool, because a shell line such as
  `echo ======` fails in zsh (a word starting with `=` is looked up as a command). The
  spec-pipeline defaults are copied from `src/core/framework-config.ts`, and a unit test fails if
  they drift. The spec-pipeline nudge is silent when the pipeline is off, on the fast lane and on a
  route that is not feature development.
- **`agent-entry-session-start.mjs` (SessionStart).** Removes only this session's sentinel and
  resets the per-agent markers, then aligns the single-slot ledger-session cache to the live host
  session id, so a `paqad-ai stage start` before the first edit does not mint a bundle under a stale
  id while the gate keys on the real one. It also carries an in-flight change across a session-id
  rotation (it never mints a bundle) and records the tracked files already dirty at session start,
  so the completion backstop can subtract inherited dirt. It steps aside when the plugin owns the
  session.

### Capability, decision and stage hooks

- **`capability-gate.mjs`.** One host hook runs every capability bound to a seam (`pre-mutation`
  for PreToolUse, `completion` for Stop). It skips the dist import when there is no work: the
  pre-mutation seam always has work on an enabled project because rules-loaded is required with no
  mode; stages run by default; rule scripts only when a rule-script map exists and
  `rule_compliance` is not floored off. The rule-script map path is copied by hand from
  `PATHS.RULE_SCRIPT_MAP`. The payload parser yields `targetPaths` for every edited path, so a
  multi-file patch is gated when any path is feature development. On the completion seam the gate
  defers (with a `completion-deferred` breadcrumb, exit 0) while a `paqad-<stage>` agent still runs
  in the background, so a half-finished change is not graded. The capability completion seam still
  runs between stages, and the Gemini record-only hook makes the same deferral before it writes. Only the completion seam honours the
  host's `stop_hook_active` loop guard; pre-mutation is a deny, not a loop, so it keeps its teeth.
  Narration rides ahead of a block reason so work already recorded stays visible.
- **`decision-pause-gate.mjs`.** Blocks edits while a packet sits in `.paqad/decisions/pending/`,
  read from the worktree named by the payload's `cwd`. `verify-backstop.mjs` is the second layer
  where this hook is unavailable.
- **`stage-writer.mjs`.** A writer, not a gate: it records `live-mark` rows from the script clock
  for each edited path (a Codex patch can touch several) and always exits 0. It passes the
  subagent's `agent_type` and `agent_id` raw so the identity mapping stays in the compiled,
  coverage-counted code.
- **`stage-marker-parse.mjs`.** Ordered before `verification-completion.mjs` on Stop so spoken
  `paqad:stage` markers are in the ledger before the backstop folds the change.
- **`stage-agent-start.mjs` (SubagentStart).** Seeds a stage helper with its stage brief
  (`src/stage-isolation/stage-brief.ts`): role, read list and instructions, the change, the lane,
  the previous pillar files that exist, the hard rules and the exact stage commands, capped at
  9,000 characters. It prints the brief as `additionalContext`, and only then writes the per-agent
  entry marker `.paqad/session/agent-entry/<agent_id>` the entry gate already accepts. It stands
  down when paqad is off, the repo was never onboarded, or the other install route owns the
  session. It refuses a session id outside `^[A-Za-z0-9._-]{1,128}$`. Every outcome adds one line
  to `.paqad/logs/hooks.log` (seeded, skipped or failed, with the agent id and stage, never the
  brief or the payload). On any error it prints nothing, writes no marker and exits 0, so the
  helper falls back to loading the framework itself. It writes no stage-evidence row.
- **`stage-agent-completion.mjs` (SubagentStop).** Wired only for paqad's own `^paqad-` agents.
  Blocking a SubagentStop is undocumented on Claude, so it always exits 0. High Table seats are not
  stages, so their tokens are read from their own transcript into `high-table.jsonl`, wrapped
  separately so a failure never changes the hook's result.
- **`verification-completion.mjs` (Stop).** Runs on Claude Code and Codex, which share the same
  Stop semantics. It soft-fails on infra errors; the git and CI backstop is the hard layer. It
  resolves the project root through the shared helper, because a raw `process.cwd()` missed the
  disable flag when the host launched the hook from a subdirectory. A disabled project never
  defers: it falls through to the backstop, which writes the one disabled-session audit row.
- **`verification-record.mjs`.** For Gemini CLI's `AfterAgent`, which must never disrupt the agent.
  It always exits 0 and prints nothing, so no host can misread its output as a control decision.
  One resolved root is used for both the marker rows and the backstop fold.
- **`lib/loop-guard.mjs`.** A blocking Stop hook makes the host re-prompt and run it again, which
  loops forever on a condition the model cannot fix in-session. When Claude marks the Stop as a
  continuation (`stop_hook_active`), the block degrades to an advisory: the gate bites once, then
  lets the session end.
- **`lib/transcript.mjs` and `lib/codex-rollout.mjs`.** Every completion hook reads the transcript
  the same way so they cannot disagree about one turn. Codex Desktop's Stop payload carries no
  readable `transcript_path`, and its stage markers live in mid-run messages that the inline
  `last_assistant_message` never holds, so the fallback reads the session's rollout jsonl under
  `$CODEX_HOME/sessions` (or `~/.codex/sessions`), preferring the file named with the session id,
  else the newest. All of it is best-effort and never throws.
- **`lib/edit-targets.mjs`.** The one extractor of edited paths. Claude puts one path in
  `file_path` or `notebook_path`; Codex `apply_patch` text carries `*** Add File:`,
  `*** Update File:`, `*** Delete File:` and `*** Move to:` headers. The field holding the patch
  depends on the Codex version, so every string value of `tool_input` is scanned, and some builds
  pass the patch as the `tool_input` string itself.

### Prompt-time context and intake

- **`context-refresh-trigger.mjs`.** Fires a detached `rag refresh-context` at most once per
  2-minute debounce window, only for a human prompt (the prompt gate skips notifications,
  hand-backs and `Stop hook feedback:`), never while another refresh holds
  `.paqad/locks/refresh-context.lock`, and at low priority. The worker swaps the artifact
  atomically, so the seam never sees a half-written file; the refresh lands on the next prompt. It runs this copy's CLI with the
  current node, because a hook's PATH may not hold `paqad-ai` (the plugin only adds it to the shell
  PATH) or may hold another copy. It is inert only when `lean_rules` and RAG are both off.
- **`lib/context-seam-emit.mjs` and `context-seam-inject.mjs`.** The emit logic is a side-effect
  free module so the prompt gate can call it in-process and control ordering; the standalone hook
  is a thin wrapper. The artifact is injected whenever `lean_rules` (default on) or RAG is on;
  `rag_enabled` only governs what is composed into it. The rag-evidence outcome for the turn is
  recorded best-effort and never affects the block.
- **`ticket-intake-prompt.mjs`.** Advisory only. A slash command reaches it as the raw typed line
  and is never a ticket, so it is skipped before any import. A Desktop system notice is matched with
  the routing seam's own matcher so routing and intake agree on what a notification is. The
  `generic` tracker kind matches both Jira and GitHub style references.

### Enable switch and one-copy handshake (`lib/paqad-disabled.mjs`, `lib/paqad-disabled.sh`)

- The precedence must match `src/core/framework-enabled.ts`, pinned by a shared golden-fixture
  test: `PAQAD_DISABLED` wins, then `paqad_enable` from `PAQAD_ENABLE`, the local `.paqad/.config`,
  then the team `.paqad/configs/.config.*` merged in sorted order with the last file winning (C
  collation in the shell copy). Absent means on. Both readers are raw and dependency-free so a
  disabled, uninstalled project can still evaluate its own switch.
- Enforced mode knobs use the team value as a floor: the local file and the env var may only raise
  strictness, matching `resolveFlooredMode`.
- `claude plugin install` defaults to user scope, so plugin hooks run in every repo. A
  plugin-reached hook (`CLAUDE_PLUGIN_ROOT` set) in a project without `.paqad/framework-path.txt`
  is a pure no-op. npm-reached hooks never needed this because npm wires hooks only into onboarded
  projects.
- Exactly one hook chain runs per session. The plugin's SessionStart writes a per-session marker
  and every npm-reached hook steps aside for that session. When the session is unclaimed and the
  user or project Claude settings still wire a live npm hook (one whose `.mjs` exists), the plugin
  stays passive and its hooks stand down. The project files `.claude/settings.json` and
  `settings.local.json` are checked because that is where npm onboarding writes the chain. Every
  guard asks the one `hookStandsDown` predicate, the same test the plugin's SessionStart uses, so
  the two decisions cannot drift. With no evidence the other copy owns the session, a hook stays
  active. The hook-path parser is mirrored for the doctor by `projectWiresLiveNpmHooks` in
  `src/install/plugin-migration.ts`.

### Session start, plugin and update hooks

- **`plugin-session-start.mjs`.** Runs only under the plugin. It keeps `~/.paqad-ai/current`
  pointing at a copy that exists: it never replaces a real directory, never takes over a link that
  resolves to a working npm install (that copy serves Codex, Gemini and Cursor too), and fills a
  missing or dangling link with a stable plugin-owned location under `CLAUDE_PLUGIN_DATA` so cache
  version churn cannot leave it dangling. It uses a junction on Windows so no admin is needed. It
  makes the launcher executable (the tarball may drop the bit) and prepends its directory to the
  shell PATH with a plain assignment in `CLAUDE_ENV_FILE`, not `export`, so PowerShell reads it
  too. It writes the machine-level `~/.paqad-ai/plugin-seen.json` before the handshake, since the
  plugin loaded even if it then stands down, with the root so a claude.ai synced plugin can be told
  apart from a marketplace install. In a repo that was never onboarded it does only the global
  work, so `/paqad:onboard` can bootstrap. In a claimed session it prunes dead paqad hook lines from
  the user settings and removes the stage-agent files the npm copy wrote. When the plugin is newer
  than the recorded framework version it runs its own `update --silent` in the background under a
  single-flight lock, at most once per six hours, and never downgrades. It is kept in step by hand
  with `src/install/bootstrap.ts`, and a parity test checks it.
- **`silent-update.mjs`.** A Node port of the old shell hook, because the shell one needed bash,
  python3 and GNU `timeout` and `flock`. Any newer version triggers a background global install
  then `update --silent`; a version older than the latest two minors of the same major is recorded
  as forced. A pinned `minimum_version` that is unmet skips the interval throttle; an unsatisfiable
  floor is logged, never enforced, because this hook never blocks. A missing
  `framework-version.txt` (a teammate who cloned without onboarding) is reseeded at the epoch so
  the next session checks at once, and no check runs in the seeding session. The version comes from
  the package one level above the resolved runtime link. The single-flight lock is an atomic
  directory create, reaped after 60 minutes. `npm` runs with `shell: true` so Windows resolves
  `npm.cmd`. It reports Claude Code sessions to the plugin migration before stepping aside for the
  plugin. Its tests drive a fake `npm` through a POSIX `#!/bin/sh` shim, so the npm cases skip on
  Windows (where the hook would reach the real npm); the seed, interval and skip cases run
  everywhere.
- **`lib/plugin-migration-tick.mjs`.** The migration rollback counter must move on real sessions,
  not on update runs, so both SessionStart hooks call it. It holds no state logic; it spawns a
  detached `paqad-ai plugin tick` only when there is work, and a compact SessionStart never counts.
- **`module-health-sync.sh`.** Rollup runs before sync. They write different fields of the same
  profile: rollup the coverage, test and velocity metrics, sync the defect and verification fields
  with the processed event audit trail.
- **`pre-commit-verify.sh`.** The provider-independent git layer. `git commit --no-verify` bypasses
  it, so CI is the layer that cannot be skipped. When the runtime cannot be resolved it does not
  block the commit.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
