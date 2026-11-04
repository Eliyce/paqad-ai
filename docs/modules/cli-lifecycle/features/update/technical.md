# paqad-ai update — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `update`

## Module Boundaries

Source directories owned by this feature:

- `src/cli/commands/update.ts`
- `src/update`



## Entry Points

- CLI entry: `paqad-ai update` (verify exact flag set in the source).

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

- Unit test files that cover `update` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## Ignore file and worktree include

- After the framework-version write, `paqad-ai update` (and `update --silent`) calls
  `writeManagedGitignoreBlock` and `writeWorktreeInclude`. An upgraded project therefore gains
  ignore lines a newer paqad added (for example `.agent-entry-loaded.d/`) without being
  onboarded again.
- `writeManagedGitignoreBlock` rewrites only the managed blocks of `.paqad/.gitignore` and
  `.paqad/.gitattributes`, between the paqad markers. Every line outside a block is kept. Unlike
  onboarding's `writeGitignore`, update does not scrub the root ignore files, untrack files or
  delete old artifacts. The managed block always lists `vectors/`, whatever the RAG setting,
  and `locks/`, so the lock and marker files hooks write under `.paqad/locks/` never leave
  `git status` dirty.
- `writeWorktreeInclude` adds the one `.paqad/.config` line to the repo-root `.worktreeinclude`
  when it is missing and keeps every other line, so a new Desktop worktree gets the developer's
  local config.
- When the checkout was stamped by a newer paqad (`checkoutIsNewer`), the ignore files are left
  alone, the same rule the tracked config follows, so an older install never drops lines a
  newer one added.

## Why the `src/update/` code works the way it does

- The `.paqad/` layout is migrated forward before anything is regenerated, because a project that
  only ever ran silent updates would otherwise never migrate its records; a layout from a newer
  paqad refuses with the upgrade message instead.
- An evidence migration left unfinished because another session held a change is finished on a
  later update once that change closed; a failure (a locked file on Windows) is a warning.
- When the Claude Code plugin is installed it owns the Claude hooks and the stage agents, so the
  npm updater skips them and nothing is wired twice.
- The candidate build runs onboarding in a temp root with `interactive: false`, so `update` never
  asks a question, even in a terminal. A field it does not pass falls back to the saved profile
  and detection, never to a prompt. Before this, a person running `update` by hand got the full
  onboarding questions, and the answers decided which stack and providers were written.
- The temp onboarding gets every provider the project was set up for, from
  `deriveRecordedProviders`: the manifest's saved `providers`, or, for a manifest written before
  that key existed, every provider whose entry file is among the generated artifacts. A project
  with no manifest renders Claude Code. Without this, `update` refreshed only Claude Code's files
  and every other host's files went stale.
- After writing the files, `update` writes `providers` back into
  `.paqad/onboarding-manifest.json` and leaves `adapter` and every other field as they were, so
  the next run reads the list directly.
- Legacy MCP files are cleaned up on the real project root, because the candidate build runs in a
  temp root that the orchestrator's own cleanup never reaches.
- Workflow rules that became skills are cleaned up on the real project root for the same reason.
  `cleanObsoleteWorkflowRules` (`src/onboarding/obsolete-cleanup.ts`) deletes each of the seven
  files only when its hash, ignoring `@rule` markers, matches a version paqad shipped, and adds one
  line to the update summary per file. An edited copy stays in place and the summary says it can
  be deleted. A copy that can't be removed gets a "Couldn't remove" line that says the next update
  tries again. A project without the files prints nothing.
- After that cleanup, `update` does not recompile the rule-script map. Only when the cleanup removed
  a file does `dropRuleScriptMapSources` (`src/rule-scripts/compile.ts`) drop that file's entries.
  Every other entry, its scripts and kept copies are untouched, so edited rules still report drift.
  A valid digest is rewritten and an already invalid one is left as it is. `rule_files_hash` is
  refreshed only if the map was current. A failure becomes a note in the update summary, and a
  project with no map does not get one from `update`.
- Team settings: `migrateTeamConfig` moves old `.paqad/configs/.config.*` files and a hand-written
  `docs/instructions/workflows/feature-development.yaml` to the YAML team files once and deletes
  that file, then `removeGeneratedFiles` (`src/update/generated-files-cleanup.ts`) removes what
  older paqad versions wrote: the generated workflow copy (only when it carries the generated
  header), `.paqad/state/feature-development-view.sha256`, its `.git/info/exclude` line and the
  marker above it, `docs/instructions/workflows/` and then `docs/instructions/` when empty,
  `.paqad/configs/schemas/`, and the schema line at the top of each team YAML file. It adds one
  line to the update summary per item removed, names an item it couldn't remove and tries again
  next run, and prints nothing on a clean project. Then
  `syncTeamConfigFiles` creates any missing team file, regenerates the configs README, and re-renders every existing team
  file from its live values, so it lists every setting commented out with its default. It writes a
  file only when its text changes, names each rewritten file in the update output, and names (and
  leaves untouched) a file that isn't valid YAML or isn't a map. `update` never writes a default as
  a live value, so a new setting's default reaches the team through the code. The one exception is
  a value paqad retired (`retiredValueMap` in `src/core/team-config-values.ts`): the sync replaces
  it with its current value and adds one line to the update output. Until then paqad reads it as
  the current value and doesn't report it as invalid. `legacy_existence_check: strict` is the only
  one so far and becomes `warn`, because that check never blocks a change.
- After the move, `.paqad/configs/.config.app` is a stub whose first line is `# paqad-migrated-stub`.
  It holds `paqad_enable=false` and `minimum_version` for an older paqad, which turns itself off
  instead of running on defaults and updates on its next check. Every current reader (the CLI, the
  shell and Node hooks, the plugin mod and the team launcher) skips a file with that first line,
  so a current paqad stays on. The stub is written last, after the YAML files and the workflow
  view, so a failed write leaves the old `.config.app` in place. The move is roll-forward only: no command
  restores the old files, so a bad release is fixed by the next release or `PAQAD_DISABLED=1`.
- The stage agents are written here too, because an upgraded machine goes through
  `paqad-ai update --silent` and never reaches the onboarding path that wrote them. This is
  best-effort, since the agents are inert until dispatched.
