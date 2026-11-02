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
- **One agent, more than one stage.** When a stage agent is resumed for the next stage, its
  SubagentStop row keeps `stage` from the agent name and adds a `stages` list of every stage it
  started: its own, the `stage_start` rows stamped with its `agent_id`, and the `paqad:stage
  <stage> start` markers in its transcript (read with `extractMarkers` from `marker-parse.ts`).
  The list is written only when it holds more than the agent's own stage. The isolation summary
  and the bundle-completeness gate count every stage on that list.
- **The brief for a resumed agent.** A stage agent resumed with `SendMessage` gets no new
  SubagentStart brief, so `paqad-ai stage brief <stage>` (beside `stage settings` in
  `src/cli/commands/stage.ts`) prints the same `buildStageBrief` text for the given stage and the
  calling session's active change, with a head that says the agent was resumed instead of started.
  The SubagentStart brief writes the hook's `agent_id` on its command lines as
  `SE_AGENT_ID=<id>`, because a subagent cannot learn its own id; the verb takes `--agent-id`, then
  `SE_AGENT_ID`, then the session's open `started` stage-agent row. An unknown stage or a session
  with no active change exits non-zero with a plain message and prints no brief.
- **What planning reads.** Planning's `read:` list is the three folders the contract loads
  (`docs/instructions/stack/**`, `docs/instructions/design-system/**`,
  `docs/instructions/workflows/**`). When the brief is built, `attributedModuleReads` runs the
  module-attribution extractor over the change's title and `request.md` and adds
  `docs/modules/<module>/**` for each exact match that has a `docs/modules/<module>/` folder. With
  no named module the brief keeps the three folders, and the rest of `docs/modules` stays reachable
  through `paqad-ai index query`.
- **Claude Code versions.** The SubagentStart brief works on any Claude Code that runs paqad's
  hooks. `omitClaudeMd` needs 2.1.271 or later, and `effort` (in agent files and on the Agent
  tool) needs 2.1.292 or later. paqad does no version check: an older build ignores a key it does
  not know, and a helper with no brief follows its fallback line and loads the framework as before.

## Hook chain

- Claude Code gets, in order: PreToolUse (entry gate, stage writer, decision-pause gate, capability
  gate), UserPromptSubmit, SessionStart, Stop, SubagentStart (`stage-agent-start.mjs`, stage
  helpers only), SubagentStop (`stage-agent-completion.mjs`) and PostToolUse
  (`skill-activation.mjs`, matcher `Skill|Read`). The SubagentStart and PostToolUse hooks never
  block; the three edit gates stay fail-closed.

## Testing Entry Points

- Unit test files that cover `claude-code` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## Team setup (committed launcher)

- **Key.** `team_bootstrap_enabled` (env `PAQAD_TEAM_BOOTSTRAP_ENABLED`, default true, group app,
  section "Team and cloud setup") sits right after `paqad_enable` and resolves the same way.
- **One adapter method.** `src/adapters/claude/team-setup.ts` writes the team file group that
  onboard and update both call, against the real project root: the team keys in
  `.claude/settings.json` (`src/adapters/claude/team-settings.ts`), `.paqad/hook.mjs` from
  `runtime/templates/team-bootstrap/hook.mjs`. It no longer writes `.claude/agents/paqad-*.md`
  files and runs whether or not the plugin is installed on the lead's machine.
- **Stage agents come from the plugin.** paqad's Claude Code stage and High Table agents ship only
  in `runtime/claude-plugin/agents/*.md`, generated from `src/stage-isolation/stage-agents.ts` by
  `node scripts/build-plugin-manifest.mjs` and checked for drift in CI; never hand-edit them. The
  user-scope copy in `~/.claude/agents/` is written only when the paqad plugin is not installed, so
  npm-only users keep their stage agents. Codex keeps its written agents.
- **Migration.** `migrateProjectStageAgents` (`src/onboarding/stage-agent-migration.ts`) removes a
  project's old `.claude/agents/paqad-*.md` file, stamped or unmarked, only when its body matches a
  known generated body (the hash list in `src/onboarding/stage-agent-past-bodies.ts`). A marker or
  stamp alone is not enough. Hand-edited files and symlinks are kept and named, and nothing else in
  the folder is touched.
- **Bash write guard.** The PreToolUse hook `runtime/hooks/stage-agent-write-guard.mjs`
  (`src/stage-isolation/bash-write-guard.ts`) checks Bash writes by paqad stage agents, and the
  Edit/Write branch of `src/stage-isolation/capability.ts` applies the same limits. Read-only stage
  agents write only to `.paqad/tmp/` and the system temp folder; High Table seats only to
  `.paqad/tmp/high-table/`. A target that cannot be resolved, and any unknown `paqad-*` agent, is
  denied.
- **Missing agents stop the flow.** At SessionStart in an onboarded project, when neither the plugin
  agents nor the home copy is present, the hook prints `stage agents are missing` with Needs your
  attention, telling the Developer to run `/plugin install paqad@eliyce` and start a new session.
  paqad stops there instead of running a stage in the main session.
- **`.claude/settings.json` is tracked and portable.** It holds only
  `extraKnownMarketplaces.eliyce`, `enabledPlugins["paqad@eliyce"]` and the launcher chain.
  The chain is `buildHostHookChain('claude-code')` with only the command mapped to
  `node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" <script>.mjs [args]` and a 600 second timeout on the
  two SessionStart entries. paqad entries are matched by `/.paqad/hook.mjs`; non-paqad content and
  any line with an absolute home path move to the git-ignored `.claude/settings.local.json`. The
  managed `.claude/.gitignore` block lists `settings.hooks.json` and `settings.local.json`.
- **Versions.** The launcher carries the paqad version that wrote it; an older paqad
  leaves newer files alone, so two versions do not flip the files back and forth.
- **Opt out.** With the key false, update removes the launcher lines, the two plugin keys, and the
  launcher file whose bytes match what paqad wrote, and writes the npm chain to
  `.claude/settings.local.json`.
- **The launcher.** Node built-ins only. At SessionStart it picks one route per session (installed
  plugin, npm install, its own copy in `~/.paqad-ai/team-plugin`, or none), records it under
  `.paqad/session/` and logs it to `.paqad/logs/hooks.log`. The copy is a `git clone --depth 1`
  of `Eliyce/paqad-claude-plugin` under the lock `~/.paqad-ai/locks/team-plugin.lock`, refreshed
  after 6 hours. In a cloud session (`CLAUDE_CODE_REMOTE=true`) it sets `PAQAD_RAG_ENABLED=false`.
  `paqadHookScriptPath()` ignores launcher lines and `claimedRootIsLive` counts the copy as a live
  claim, so the plugin's stand-down logic keeps one chain per session.

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
  the session snapshot and builds the band's view, `shell.ts` owns the band card (header, chips,
  minimise and close) and the per-workflow body registry, `band.ts` picks what the prompt area shows
  (the card, the minimised or closed line, the status entry or nothing) and gives the spinner's
  stage words and the footer's lane, `instruments.ts` is the feature-development body (STAGE,
  HIGH TABLE and SHIP), `ship.ts` reads the ship rail and draws its Desktop SVG, `status-entry.ts`
  draws the one line other workflows get, `visibility.ts` owns minimise, close and hide,
  `commands.ts` answers `/paqad`, `pane.ts`, `tabs.ts` and `cost.ts` fill the paqad Ledger,
  `table.ts` draws the High Table (its seat data, its live chat card and its Ledger tab), `receipt.ts` draws the receipt card and decides
  when a verdict has landed, `ask-evidence.ts` reads a decision packet's evidence, `chips.ts`
  turns paqad's own Bash rows into chips, `chime.ts` builds the chime clip, and `paqad-cli.ts` is
  the one helper that runs `paqad-ai`. On Desktop, `desktop-view.ts` is the pure view model of the
  band and the Ledger, `desktop-band.tsx` and `desktop-ledger.tsx` draw them, `strip.ts` draws the
  plain-image Svg art and `palette.ts` holds every colour it uses; `command-name.ts` names the
  command in every hint. The pure modules import nothing from Claude
  Code, so vitest tests them without the host; `cost.ts` and `table.ts` import nothing from
  `model.ts`, so `model.ts` can use them without an import cycle. `register.test.ts` runs the glue
  against Claude Code's own test kit (`pnpm run plugin:test`): terminal tests keep the terminal
  drawing, Desktop tests follow the Desktop design, and one test per scene mounts the band and every
  Ledger tab on Desktop and presses every control; `test/world.ts` and `test/fixtures.ts` are
  test-only and not shipped.
- **It only shows and asks.** Every check stays a hook in `hooks.json`, so the mod being off,
  blocked or broken changes no hook's decision. It reads only `.paqad/`, writes only its own
  heartbeat, calls no model or network, and starts a process only through `paqad-cli.ts` for the
  fixed `paqad-ai` verbs it lists. Refresh points pass each event on untouched and return what `next`
  answered, and a `.catch` replays `next` if anything throws. A render hook never writes state;
  only presses and `tool.call` do. On any failure the mod stays dark. A snapshot file that exists
  but cannot be read or parsed shows the idle line with a dim `HUD data unavailable` on the
  terminal, and `● paqad cannot read this session's record` in coral on Desktop (also when the
  session id cannot be read) under the brand row with its `Ledger`, `−` and `×` controls, so the
  Ledger's Trust tab can still give the reason; never a verdict, flags, ship rail or cost from a partial read. State is rebuilt at `session.start`, since a hot reload drops module
  variables and timers.
- **Stand-down order** (`config.ts`): never onboarded, a cloud session (`CLAUDE_CODE_REMOTE=true`),
  paqad off, the view turned off, or Claude Code older than 2.1.301 (an engine that cannot state its
  version counts as too old). These need `$` to read, so they are decided at `session.start`; until
  then every hook passes straight on. In a project never onboarded only `/paqad` is registered, so
  `/paqad status` can say paqad is not active here. The enable switch resolves exactly as the hooks
  resolve it, and the `.paqad/` folder is found by walking up from the session root as the hooks do.
- **Snapshot.** `model.ts` reads the file `src/hud/snapshot.ts` writes (`paqad.hud/3`) and makes the
  session id filename-safe exactly as `src/hud/files.ts` does. A missing, half-written or foreign
  file reads as idle, never a throw. The snapshot carries `scope`: the mod shows a change only when
  `scope.qualified` is true, and makes no scoping decision of its own (the rule lives in
  `src/hud/change-scope.ts`). An older `paqad.hud/2` snapshot has no `scope`, so a newer mod reads it
  as idle; an older mod reading `paqad.hud/3` keeps rendering, since every field it knew is still
  there. Nothing is guessed: a field with no record reads "not yet"
  and is never invented. The band re-reads every 1.5 seconds while a stage agent or Agent call
  runs, and once more after a turn ends for what the Stop hooks write.
- **Honest stages.** A stage reads done only when the receipt would print done; a `checks` stage
  with no passing tests-and-lint gate reads "tests not verified". Spec reads "not required" on the
  fast lane, which needs no frozen spec. The delivery rail has no Merge step: merging is the owner's and
  paqad never merges.
- **State and colour.** The state is the first match of: waiting on you (`waitingOnHuman`: a
  question on screen, a permission a person must answer, or a pending decision), no change in
  progress (paused, another workflow, or ready), an open branch flag, a running stage, the
  verdict (skipped when it was written before the current turn started), then working. A rule
  stop is never a state. Tones map `working` to suggestion, `needs-you` to permission, `good` to
  success, `warn` to warning, `bad` to error. Any open flag turns the band amber, even at Safe to
  merge; red and "needs you" keep their own colour, and all green turns it success. Every state is
  said in words and by a glyph of its own shape, so each line reads the same with the colour gone.
- **The band card (terminal).** On the feature-development route the band is one rounded card
  whose border takes the headline tone. The header holds the `paqad` brand Button, the change chip (the issue
  number, else the ticket, else the last six characters of the ULID), the headline, then on the
  right the verdict chip (a fresh verdict only), one amber flag chip, the lane, the tokens chip,
  a `Proof` Button, `– Minimise` and `× Close`. Before the first snapshot is read the card shows the
  header only, `paqad  Getting ready`; with a snapshot but no change open, nothing is drawn. The body comes from `BAND_BODIES`, a
  per-workflow registry in `shell.ts` that only feature development fills; the shell imports no
  body code.
- **Instruments.** STAGE shows eight labelled cells (Intake Plan Spec Build Review Checks Docs
  Deliver) with `●` done, `▸` running, `○` not yet, `–` not required, `✗` failed and `◐` marked
  without recorded work, and a status such as `Build · 12:08` or `paused for you`. HIGH TABLE shows
  one column per seat with a two-letter role (PO AA QA UF, on-call seats such as SA IA DO) and the
  chief `CA` after a separator, with `●` note landed, `◉` writing, `○` seated, chief `◆` ruled or `◇`
  waiting (amber when it needs answers), and a status of `n standing`, `x of y notes`, `chief is
  ruling`, `needs answers` or `spec approved`; it is not drawn on the fast lane. SHIP shows Edit
  Commit Push PR CI (no Merge step): on the terminal as marks on a `─` track, on Desktop as one SVG of git
  icons with a CI ring filled done over total and an `alt` text that says the same in words. Its
  note says when CI was last read and `+n already on the branch, not yours` for inherited commits.
  The three sit in one row from 110 columns and stack below; a footer (row layout only) holds the
  cost line and one trust summary that leads with `Not judged yet` until a gate is judged. The card
  counts its rows (border, header, instruments, footer): when `maxRows` is short the footer drops
  first, then the band falls back to the minimised line. A seat's note budget and its run tokens
  always carry their own labels: `Note: ~6.2K tokens of its 8K budget` and `Run: 230K tokens,
  mostly the code it read (exact)`.
- **The band on Desktop.** Desktop draws its own card with no border, tint, logo or hotkey. The
  identity row holds `paqad` (plain text), the workflow, the lane, the change and its cost, then the
  coral `⚑` with the flag count as a plain dim Button, a `Ledger` Button, and plain dim `−` (or `⤢`
  when minimised) and `×`. The message row has one light in the signal colour and the headline,
  with a running clock while something is live. The strip is one plain-image Svg (stages, the High
  Table when it sat, and only the `delivery_plan` steps) with an `alt` that says the same in words.
  The headline is the first match of the Part B table in `desktop-view.ts`. The card needs 5 rows (6
  with the close menu open) and falls back to the minimised row below that. `×` opens an inline
  menu: `Close for now`, `Hide always` and `Cancel`. Before the first snapshot the band reads
  `paqad   Ready`. Other workflows get one row with the workflow, `running · m:ss` or `idle`, the
  cost and a `Ledger` Button.
- **Motion on Desktop.** A live light breathes and a live clock ticks on one 400 ms tick that sets
  the clock from `$.clock.now()`; the tick runs only while the band or the Ledger draws something
  live and stops otherwise. Every other motion lives in the Svg's own CSS and SMIL animations.
- **CI passed.** When the saved CI reading is a pass on the pull request's current head and the
  pull request is open, the rail reads `CI · <n> of <n> green`, the headline stays `Done` and one
  toast naming it fires per change and head commit (kept in `$.state`), with the opt-in chime.
  The HUD never offers a merge and never notes one: merging is the owner's. While the pull
  request's CI is pending the headline reads `Coding Done: Watching CI` and the mod keeps the rail
  current with
  `paqad-ai delivery-link refresh` (see [hud.md](../../../../instructions/design-system/hud.md)).
- **Done and finished stages.** `Done` shows once the paqad work is done, before any push. Finished
  stages draw green with a check, and the strip glows once for about 2 s when the last stage ends
  while the HUD is watching.
- **Other workflows.** On any other route there is no band, only one `AbovePrompt` row: a plain
  Button reading `paqad · question · 84K tokens · ~$0.05` (the workflow in words, its tokens and
  cost since that workflow started in this session), with `running m:ss` while a main-agent turn is
  in flight (from the mod's own `prompt.submit` to `turn.complete`) and `counting` before tokens
  are known. It opens the Ledger in workflow mode, which shows only the cost block. With
  `no-workflow` or no route nothing is drawn. `$.ui.status` is not used, since it is plain,
  uncoloured text that cannot be pressed.
- **Minimise, close and hide (terminal).** `– Minimise` keeps one line (brand, change chip, state word, stage
  bar, stage clock, High Table count, ship step, flag chip, tokens, `+ Restore` and `× Close`) and is
  kept in `$.store` as `band.minimised`, so it survives sessions. When narrow, the line drops tokens,
  then the ship step, then the High Table count, then the stage bar, and never wraps. `× Close` asks
  Close for now (the `paqad.bandClosed` atom, this session only) or Hide always (`$.store` key
  `band.hidden:<project root>`, so it applies to this project only). Closed or hidden, the band is
  one line `paqad · <state> ▸` with a dim `Closed for this session · /paqad show` or `Hidden always ·
  /paqad show`; pressing it brings the band back. While the band is out of the way and something
  waits on you (`waitingOnHuman`), the line turns amber and reads `paqad · Waiting for your answer ▸`;
  the band never reopens by itself and the question is still asked in chat. `/paqad show` clears
  all three and answers `The paqad band is back.` `/paqad hide` sets `band.hidden:<project root>`
  and answers `The paqad band is hidden. Run /paqad show to bring it back.` Each control has a hotkey and names its action in
  words. None of this changes what paqad enforces, and the mod writes no file for it.
- **The paqad Ledger (terminal).** The pane keeps the id `paqad`, is titled `paqad Ledger` and
  starts with the dim subtitle `what happened, with proof`. Its tabs are Trust, High Table, Ships, Record and Cost,
  and it opens on Trust unless a tab was picked. Trust shows the fresh verdict or `Not judged yet`
  with `Gates are judged after Build, Review and Checks. Nothing reads as a pass before that.`, the
  gate ring `n/m required` (an SVG on Desktop), each gate as `pass`, `fail`, `not judged yet`, `did
  not run` or `not required`, then `Claims and the tests that prove them` and `Flags`. High Table
  shows the ring, the seats and `Who shaped the spec` (or `Shown when the spec is frozen: each spec
  line with the experts who shaped it.`). Ships lists Edit, own commits by sha and message with
  inherited ones marked `on the branch already`, Push, the pull request with its state and an `Open PR` link
  while it is open, and CI with one line per job and the read time. There is no Merge row. Record lists the plan, decisions, rules,
  receipt and the change's timeline, an abandoned close and its note among them. Cost says whether
  it counts this change only or the whole session. The brand, Proof, each instrument title, the
  flag chip, the tokens chip and both footer lines open their tab, and pressing the target of the
  tab already shown closes the pane. The Ledger opens on its own, without focus, once per change;
  the change key is kept in `$.store` `ledger.autoOpened` (the last 50), so it never opens itself
  again for that change, in any session. On a narrow terminal the engine holds an unasked pane
  until the terminal is widened; that still counts as opened.
- **The paqad Ledger on Desktop.** The same pane draws the Desktop design: the subtitle `What
  happened, with proof` and the change, then equal tabs (Trust, High Table when the table sat,
  Delivery, Record, Cost) with a pink rule under the shown one. Trust starts with one light that
  says why, the gate ring with its legend, every gate in words with how it is judged, the claims
  with the tests that prove them, and the flags. High Table shows the ring, the summary, the chief
  (`Answer in chat` fills the prompt box with `Walk me through the N open decisions`, or toasts when
  the box cannot take it, and `See each side` shows each conflict's recommendation), the seats with
  their details behind `›`, and who shaped the spec, read from the bundle's `spec.md`. Delivery has
  one block per `delivery_plan` step with its node art, CI jobs with meters and an `Open PR` link
  when the merge is ready. Record lists the events in local time, and Cost the total, each stage
  and each seat. Another workflow gets only its light and its cost. The `Ledger` Button toggles the
  pane on Trust and the flags open it on Trust; the brand and the strip open nothing on Desktop.
- **Mod API limits.** Buttons hold only strings and Text, so an instrument opens its tab from its
  title, not from the whole box. `$.ui.ask` takes plain option labels and a header of at most 12
  characters, so the close question uses the header `Close band?` and carries the spec's full
  words in its text: `Close the paqad band?`, then each option with its meaning. `$.ui.open` takes no
  `focus: false`; leaving `focus` out keeps the prompt focused. On the terminal the static marks
  carry the whole meaning. `Svg` draws only on Desktop and mobile; the terminal never gets one. On
  Desktop a Button with a `label` draws only the label, a `plain` Button drops its child styles,
  `role="dismiss"` and `hotkey` draw chips, an `isInteractive` Svg sits in a tall frame, and a Box
  `width` must be a whole-number percent, so the Desktop drawers use none of those.
- **Cost.** Every money figure carries the word estimate and the price table's date; a record with
  no price date keeps its tokens and loses its money, and a model the price table does not list
  adds tokens only.
- **High Table.** The card is drawn over the change's first `paqad-ai spec pipeline experts` chat row
  only, so it is drawn once and updates in place; a folded run that holds that call unfolds. Host
  usage reads as exact, a seat's own count as an estimate. The round table is an SVG on Desktop and
  text on the terminal; its colours are named so they can become design tokens later. A decision's
  day is read from the first ten characters of its `D-<ULID>` id.
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
- **Decisions.** The band and the Ledger show only the pending packets stamped with this change.
  `/paqad decisions` lists every pending packet in the repo, labelled `in this repo`, so a packet of
  another change or one with no change is never lost.
- **Command name.** The `/paqad` hook name is written as a literal in the hook and its matcher, so
  `claude plugin validate` reads it as a hook that answers its own command, not a gate. The mod
  binds the session before it registers any command, so the HUD draws even when another plugin
  owns `/paqad`. If the engine refuses `/paqad`, the mod registers `/paqad-hud` with the same
  subcommands and writes the refusal to the debug log only; every hint (`slash()` in
  `command-name.ts`) then names `/paqad-hud`. If both are refused the HUD still draws and nothing
  escapes the hook. `/paqad delivery` is an alias of `/paqad ships`.
- **Task list.** On a feature-development prompt the prompt gate prints the lane's task-list
  sentence next to the `SE_SESSION` line (Plan, Spec, Load rules, Build, Review, Checks, Docs; the
  fast lane Plan, Build, Checks). The mod's `tool.call` hook on `mcp__ccd_turn__update_plan`
  refuses, once per turn and only on the feature route, a list with items whose openings miss the
  lane's stage words in order, answering with the same sentence; `advance`, `done` and `start` calls
  always pass, and a new prompt resets the turn.
- **Types.** `types/index.d.ts` is the `$.state` contract named in the plugin's `plugin.json`; it is
  self-contained (no import or reference), as Claude Code wants a plugin contract to be.
