# Claude Code (CLAUDE.md) — Technical View

> Module: **Adapter Onboarding (LLM platform entry files)** (`adapter-onboarding`) · Layer: `cli-commands` · Feature slug: `claude-code`

## Module Boundaries

Source directories owned by this feature:

- `src/adapters`
- `src/onboarding/file-writer.ts`

Generated outputs (when applicable):

- `CLAUDE.md`

MCP config is not a generated output: paqad never writes another tool's MCP file (issue #622). Server
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
  `config.ts` decides whether the mod stands down, `model.ts` reads the session snapshot and
  builds the band's view, `band.ts` lays the band out in rows, `commands.ts` answers `/paqad`,
  `pane.ts` and `cost.ts` fill the paqad pane, and `table.ts` draws the High Table (its band
  instrument, its live chat card and its pane tab). The pure modules import nothing from Claude
  Code, so vitest tests them without the host; `cost.ts` and `table.ts` import nothing from
  `model.ts`, so `model.ts` can use them without an import cycle. `register.test.ts` runs the glue
  against Claude Code's own test kit (`pnpm run plugin:test`), each UI test on both the terminal and
  Desktop; `test/world.ts` and `test/fixtures.ts` are test-only and not shipped.
- **It only shows and asks.** Every check stays a hook in `hooks.json`, so the mod being off,
  blocked or broken changes no hook's decision. It reads only `.paqad/`, calls no model or network
  and starts no process. Refresh points pass each event on untouched and return what `next`
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
  pane opens on the High Table when the change has one, else on Cost.
- **Command name.** The `/paqad` hook name is written as a literal in the hook and its matcher, so
  `claude plugin validate` reads it as a hook that answers its own command, not a gate.
- **Types.** `types/index.d.ts` is the `$.state` contract named in the plugin's `plugin.json`; it is
  self-contained (no import or reference), as Claude Code wants a plugin contract to be.
