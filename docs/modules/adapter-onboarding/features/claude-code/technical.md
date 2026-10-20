# Claude Code (CLAUDE.md) — Technical View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `claude-code`

## Module Boundaries

Source directories owned by this feature:

- `src/adapters`
- `src/onboarding/file-writer.ts`

Generated outputs (when applicable):

- `CLAUDE.md`

MCP config is not a generated output: paqad never writes another tool's MCP file. Server
suggestions go to `.paqad/mcp-recommendations.json`.


## Entry Points

- CLI entry: `paqad-ai claude code` (verify exact flag set in the source).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `cli-commands` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- What state this feature reads.
- What state this feature writes.
- Where that state is persisted (`.paqad/**`, project files, in-memory only).

## Error Codes

- Structured error IDs emitted by this feature.
- Mapping from error ID → user-facing message → recovery action.

## Dependencies

- **Internal:** other paqad-ai modules this feature imports or calls.
- **External:** npm packages, system binaries (`node`, `git`, etc.).
- **Runtime data:** files that must already exist before this feature runs.

## Configuration

- Environment variables read.
- Config keys in `.paqad/project-profile.yaml` or `.paqad/onboarding-manifest.json`.
- Default values and override precedence.
- **HUD settings.** `hud_view` (env `PAQAD_HUD_VIEW`, default on) shows or hides the HUD.
  `hud_chime` (env `PAQAD_HUD_CHIME`, default off) makes the mod play one short chime when a
  verdict lands, once per verdict and never per snapshot rebuild; it is a chime only and the mod
  never speaks. Both live in the team-owned app config (`.paqad/configs/.config.app`) and resolve
  like `paqad_enable`: the env variable first, then `.paqad/.config`, then
  `.paqad/configs/.config.*` with the last file name winning. `config reconcile` and `update` keep
  a team value; `.paqad/.config.example` lists both with their defaults.
- **Stage helper effort and model.** Twelve keys in the team-owned models config
  (`.paqad/configs/.config.models`), section "Stage agents": `stage_effort_<stage>` (env
  `PAQAD_STAGE_EFFORT_<STAGE>`; one of low, medium, high, xhigh, inherit) and
  `stage_model_<stage>` (env `PAQAD_STAGE_MODEL_<STAGE>`; one of inherit, haiku, sonnet, opus),
  for planning, specification, development, review, checks and documentation_sync. Defaults:
  planning, specification and review high; development inherit; checks and documentation_sync
  low; every model inherit. A team may lower review, but a lighter review catches less. An unknown
  value falls back to the default. They resolve like every other key (env, then `.paqad/.config`,
  then the team files) through `resolveStageAgentSettings` in `src/core/framework-config.ts`.
- **Agent files keep the defaults.** The helper files at user scope and in the plugin are shared by
  every project, so they always carry the default `effort` (omitted when it is inherit),
  `model: inherit` and `omitClaudeMd: true`. A project's own values apply on the next dispatch:
  the orchestrator runs `paqad-ai stage settings` once per change, which writes
  `.paqad/session/stage-settings.d/<session id>.json` and prints JSON giving each stage its
  `effort`, its `model` and a `pass` string that says in plain words what to pass on that
  stage's Agent call. The orchestrator passes `model` and `effort` when they are not inherit.
  Because the files keep the defaults, inherit alone would leave a default effort in force, so
  for a stage set to inherit whose file carries a default effort the `pass` string tells the
  orchestrator to pass its own current effort level on that Agent call; for inherit with no file
  default it says to pass nothing. The SubagentStop recorder copies that stage's values onto its one `stage-agent`
  row as `requested_effort` and `requested_model`: what the project asked for, not what the
  helper ran at.
- **Claude Code versions.** The SubagentStart brief works on any Claude Code that runs paqad's
  hooks. `omitClaudeMd` needs 2.1.271 or later, and `effort` (in agent files and on the Agent
  tool) needs 2.1.292 or later. paqad does no version check: an older build ignores a key it does
  not know, and a helper with no brief follows its fallback line and loads the framework as before.

## Hook chain

- Claude Code gets, in order: PreToolUse (entry gate, stage writer, decision-pause gate, capability
  gate), UserPromptSubmit, SessionStart, Stop, SubagentStart (`stage-agent-start.mjs`, stage
  helpers only) and SubagentStop (`stage-agent-completion.mjs`). The SubagentStart hook never
  blocks; the three edit gates stay fail-closed.

## Testing Entry Points

- Unit test files that cover `claude-code` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## Onboarding from the plugin

- The plugin brings its own hook chain (`runtime/claude-plugin/hooks.json`), so onboarding from
  the plugin writes no paqad hook into the project's `.claude/settings.json`. Every other part
  of that file (attribution, permissions) is written as for npm.
- `isRunningUnderPlugin` in `src/adapters/claude/claude-adapter.ts` reads three signals:
  `CLAUDE_PLUGIN_ROOT`, the running runtime root, and the CLI entry (`process.argv[1]`). The
  last two count when they sit under a `plugins/cache/` or `plugins/data/` folder. The agent's
  shell and the plugin CLI wrapper do not set `CLAUDE_PLUGIN_ROOT`, so the path signals are what
  catch `/paqad:onboard`. With none of the three, onboarding is the npm onboarding, byte for
  byte (pinned by `tests/unit/adapters/native-hook-config.golden.test.ts`).

## The plugin runtime copy

- `~/.paqad-ai/current` must survive Claude Code deleting an old plugin cache folder. The
  plugin keeps a real copy of its `package.json`, `dist/` and `runtime/` in
  `${CLAUDE_PLUGIN_DATA}/runtime`, with a `version` file, and points the link at
  `${CLAUDE_PLUGIN_DATA}/runtime/runtime`. It never points the link at `cache/<version>/`.
- The copy carries `dist/` and `package.json` because hooks reached through the link import
  `../../dist/...` relative to themselves, and doctor and the engine installer read the
  `package.json` one level above the link target.
- The copy is staged in `${CLAUDE_PLUGIN_DATA}/runtime.tmp-<pid>` and renamed into place with
  the bounded Windows rename retry. It is refreshed only when the `version` file differs from
  the running plugin's version. A `runtime` symlink or junction left by an older paqad is
  replaced by the real folder, and a link still aimed at that old folder is moved onto the copy.
- The logic has two mirrored copies that must stay in step: `ensureStablePluginRuntime` in
  `src/install/bootstrap.ts` and in `runtime/hooks/plugin-session-start.mjs` (the hook is
  dist-less, so it cannot import the TypeScript one). `tests/unit/install/bootstrap-plugin-link.test.ts`
  drives both over the same fixtures.

## The HUD mod (`runtime/claude-plugin/mod/`)

- **Shape.** `register.tsx` is thin glue between Claude Code's events and pure modules:
  `config.ts` decides whether the mod stands down and whether the chime is on, `model.ts` reads
  the session snapshot and builds the band's view, `band.ts` lays the band out in rows and gives
  the spinner's stage words and the footer's lane, `commands.ts` answers `/paqad`, `pane.ts`,
  `tabs.ts` and `cost.ts` fill the paqad pane, `table.ts` draws the High Table (its band
  instrument, its live chat card and its pane tab), `receipt.ts` draws the receipt card and decides
  when a verdict has landed, `ask-evidence.ts` reads a decision packet's evidence, `chips.ts`
  turns paqad's own Bash rows into chips, `chime.ts` builds the chime clip, and `paqad-cli.ts` is
  the one helper that runs `paqad-ai`. The pure modules import nothing from Claude
  Code, so vitest tests them without the host; `cost.ts` and `table.ts` import nothing from
  `model.ts`, so `model.ts` can use them without an import cycle. `register.test.ts` runs the glue
  against Claude Code's own test kit (`pnpm run plugin:test`), each UI test on both the terminal and
  Desktop; `test/world.ts` and `test/fixtures.ts` are test-only and not shipped.
- **It only shows and asks.** Every check stays a hook in `hooks.json`, so the mod being off,
  blocked or broken changes no hook's decision. It reads only `.paqad/`, writes only its own
  heartbeat, calls no model or network, and starts a process only through `paqad-cli.ts` for the
  fixed `paqad-ai` verbs it lists. Refresh points pass each event on untouched and return what `next`
  answered, and a `.catch` replays `next` if anything throws. A render hook never writes state;
  only presses and `tool.call` do. On any failure the mod stays dark, and a failed read keeps the
  last good snapshot on screen. State is rebuilt at `session.start`, since a hot reload drops module
  variables and timers.
- **Stand-down order** (`config.ts`): never onboarded, a cloud session (`CLAUDE_CODE_REMOTE=true`),
  paqad off, the view turned off, or Claude Code older than 2.1.301 (an engine that cannot state its
  version counts as too old). These need `$` to read, so they are decided at `session.start`; until
  then every hook passes straight on. In a project never onboarded only `/paqad` is registered, so
  `/paqad status` can say paqad is not active here. The enable switch resolves exactly as the hooks
  resolve it, and the `.paqad/` folder is found by walking up from the session root as the hooks do.
- **Snapshot.** `model.ts` reads the file `src/hud/snapshot.ts` writes (`paqad.hud/2`) and makes the
  session id filename-safe exactly as `src/hud/files.ts` does. A missing, half-written or foreign
  file reads as "not yet", never a throw. Nothing is guessed: a field with no record reads "not yet"
  and is never invented. The band re-reads every 1.5 seconds while a stage agent or Agent call
  runs, and once more after a turn ends for what the Stop hooks write.
- **Honest stages.** A stage reads done only when the receipt would print done; a `checks` stage
  with no passing tests-and-lint gate reads "tests not verified". Spec reads "not required" on the
  fast lane, which needs no frozen spec. Merge always reads as yours until a merge is recorded,
  since paqad never merges.
- **State and colour.** The state is the first match of: a waiting decision, a rule stop, no change
  in progress (paused, another workflow, or ready), an open branch flag, a running stage, the
  verdict, then working. Any open flag turns the band amber, even at Safe to merge; red and "needs
  you" keep their own colour. Every state is said in words and by a glyph of its own shape, so each
  line reads the same with the colour gone. When rows cannot all fit, the pills ride on the
  headline row so the flag count is never what falls off. Rows are cut with an ellipsis, never
  wrapped.
- **Cost.** Every money figure carries the word estimate and the price table's date; a record with
  no price date keeps its tokens and loses its money, and a model the price table does not list
  adds tokens only.
- **High Table.** The card is drawn over the change's first `paqad-ai spec pipeline experts` chat row
  only, so it is drawn once and updates in place; a folded run that holds that call unfolds. Host
  usage reads as exact, a seat's own count as an estimate. The round table is an SVG on Desktop and
  text on the terminal; its colours are named so they can become design tokens later. A decision's
  day is read from the first ten characters of its `D-<ULID>` id. Until the person picks a tab, the
  pane follows the auto rule: Ships during a delivery, Trust once a verdict lands, the High Table
  while it sits, else Cost.
- **Chips.** A Bash row that runs `paqad-ai stage|plan|spec|review|checks|fix|rules|debt|decision`
  is drawn as a chip ("Build started recorded", "Review ended blocked") when the bundle holds the
  call or the row ran, failed or was blocked; each state has its own mark, colour and word. A row
  the bundle does not hold is drawn raw, and a run the person unfolds shows every call raw. A folded
  run shows the chips, then the engine's own line for any other calls.
- **Spinner and footer.** While a stage runs the spinner says what it is doing ("Building",
  "Running checks"), and the session footer adds "paqad <lane> lane" while a change is in
  progress.
- **Heartbeat.** While the mod is on it writes `.paqad/session/hud/<session>.live` at session start,
  on each prompt and every minute. The prompt gate (`runtime/hooks/lib/hud-heartbeat.mjs`) adds one
  static line asking the agent to skip the per-stage `▸ paqad` lines, and keep the route line and
  the receipt, only on Claude Code and only while that session's heartbeat was modified in the last
  120 seconds. A heartbeat of another session, an older or a future one, or none, leaves the gate's
  output byte for byte as before; a read failure is logged and adds nothing. No gate reads the
  heartbeat to allow or deny anything.
- **Command name.** The `/paqad` hook name is written as a literal in the hook and its matcher, so
  `claude plugin validate` reads it as a hook that answers its own command, not a gate.
- **Types.** `types/index.d.ts` is the `$.state` contract named in the plugin's `plugin.json`; it is
  self-contained (no import or reference), as Claude Code wants a plugin contract to be.
