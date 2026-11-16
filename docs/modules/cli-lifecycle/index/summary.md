# Project Lifecycle Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-lifecycle`

## Purpose

The day-one and day-N commands that bootstrap, refresh, and upgrade
a project's framework footprint without re-running full onboarding.

## Source Footprint

- `src/cli/commands/install.ts`
- `src/cli/commands/join.ts`
- `src/cli/commands/new-project.ts`
- `src/cli/commands/onboard.ts`
- `src/cli/commands/onboarding.ts`
- `src/onboarding/journey/`
- `src/cli/commands/refresh.ts`
- `src/cli/commands/setup.ts`
- `src/cli/commands/managed-settings.ts`
- `src/cli/commands/hook.ts`
- `src/cli/commands/update.ts`

## Features

- [paqad-ai install](../features/install/business.md)
- [paqad-ai managed-settings and paqad-ai hook](../features/managed-settings/business.md)
- [paqad-ai join](../features/join/business.md)
- [paqad-ai new project](../features/new-project/business.md)
- [paqad-ai onboard](../features/onboard/business.md) (also covers `paqad-ai onboarding`, the staged onboarding journey that `/paqad:onboard` drives step by step with a HUD card; see [api](../features/onboard/api.md))
- [paqad-ai refresh](../features/refresh/business.md)
- [paqad-ai setup](../features/setup/business.md)
- [paqad-ai update](../features/update/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code of these commands and the shared CLI shell in
`src/cli/`.

- **`join.ts`.** Join changes no tracked file. It sets up the home install first (the framework
  symlink and stage agents under the user home), because on a machine that never onboarded a
  project every hook would otherwise point at a missing module and all gates would be silently off.
  It regenerates the git-ignored host config paqad owns even when present, so a teammate on an old
  hook set is refreshed, but a tracked file that matches an ignore pattern is never overwritten
  (`check-ignore --no-index` does not consult the index, so a tracked check runs first). It
  rebuilds the per-machine artifacts a clone does not bring: the detection reports `doctor` reads,
  the code-knowledge index (not its tracked registries), delivery detection, and the quality
  baseline from the clean HEAD, only when none exists. `framework-version.txt` is seeded at the
  epoch so the next session's update check fires at once. A tracked hooks dir, or any `.husky/_` holding the runner `h`, is not written; the
  line to add is printed. `--non-interactive` never prompts. Every step is best-effort.
- **`onboard.ts`.** A bad `--stack` is checked up front so the message names the valid stacks
  instead of a schema error. Without npm only the Claude Code plugin can be wired, so the provider
  defaults to `claude-code`. The success banner prints before the optional RAG step so a hanging
  prompt cannot hide it, and a reverted legacy value prints a one-time notice.
- **`refresh.ts`.** A flagless refresh is a status-only no-op, because every target is opt-in. It
  never touches the design system (owned by the documentation workflow) and re-renders entry
  files only for adapters already present, so it never onboards a new provider. The differential
  refresh reads the changed files straight from git. Refresh has no full rule reset: rules are
  kept current by the rules-discovery workflow, which changes them only after owner sign-off.
- **Update and recipes.** On Codex, `update` writes the stage recipes to `.agents/skills/` from the running
  install, and a failure there does not stop the update. It cannot restore a recipe missing from the install
  itself: recipes come from that install, so the repair is to update the install first.
- **Team files stay put.** `update` and `onboard` rewrite an existing team file only for a migration, a
  retired value, a removed setting or a stale workflow entry. Explicit writes such as `config set` still
  re-render the file. `schema_version`, `catalog_version`, `LAUNCHER_REVISION` and
  `managed_block_version` are whole numbers that change only with a layout, so a new release doesn't
  touch the 17 team files, `.paqad/.config.example`, `.paqad/hook.mjs` or the managed `.gitignore` block.
- **`config.ts`.** `config effective` shows, per knob, the value that binds, where it came from and
  who reads it. The consumer map is curated by hand and names a real reader for every setting. The
  two floored knobs show the value their resolver uses, not the raw surface value.
- **`dashboard.ts` and `graph.ts`.** With paqad disabled the server is not started, and the command
  exits 0 because that is a healthy state. `--print-url` prints exactly one line, which the
  dashboard skill depends on. The hidden `graph` alias reuses the dashboard's port range.
- **`compliance.ts`.** A spec path outside the project root is rejected through the shared
  artifact-path helper, since `path.relative` happily produced `../..` escapes.
- **`index-cmd.ts`.** `index build` also refreshes the tracked reuse catalog and module-map symbols;
  the background refresh deliberately does not. The doc-derived framework backstop runs after the
  offline build, so the builders stay synchronous and network-free. An absent or deprecated symbol
  is reported through the exit code too.
- **`duplication.ts`.** The armed rule script shells out to `--json` so every project-local rule
  script stays dependency-free.
- **`sitemap.ts`.** A canonical map on disk that reads back null is corrupt, and the run refuses
  instead of overwriting authored work. Units leave `artifact` null because they share the map file
  and crash recovery deletes a writing unit's artifact. `status` always exits 0 and never resets a
  unit, so it is safe to run mid-run.
- **`program.ts` and `index.ts`.** The verbs that move a change refresh the HUD snapshot when they
  finish, best-effort. `index.ts` re-exports the runtime-root helper so a dist test can prove the
  CLI bundle resolves the same root as the one the Stop hook imports.
- **`status.ts`.** `status --verdict` prints the verdict word and reasons from this session's HUD
  verdict record, or says there is no record and why. `doctor` warns, never fixes, when the home
  folder holds `~/.paqad/framework-path.txt`, because the HUD then binds to the home folder; paqad
  never deletes that file.
- **`ui/banner.ts`.** A path too long for the frame is printed under it, because `pad()` never
  truncates. Codex loads project hooks only once the `.codex/` layer is trusted, so onboarding
  prints the one-time `/hooks` step.

### Plugin migration defaults (#902)

`plugin_migration` is on by default and the minimum Claude Code is the mod's `MIN_ENGINE` (2.1.301), so the plugin's hooks never arrive without its HUD. Team repos get the user-scope install too, and old `project-turns-plugin-on` records retry at once. Opt-outs: plugin off in user or local settings, `claude_install_mode=settings`, managed policy, CI or headless, and cloud. On a local machine the launcher's copy route runs the hidden `plugin migrate` in the background; the one-time reload line shows once per session. `doctor` reports a snapshot fresh for 15 minutes with a stale heartbeat as "HUD not attached" and warns.

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
