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
  `syncTeamConfigFiles` creates any missing team file and regenerates the configs README. It leaves an
  existing team file alone unless it has a reason to write: a migration (swapping `paqad_version` for
  `schema_version: 1` and correcting two header lines), a retired value, a removed setting or a stale
  workflow entry. So a new setting no longer appears as a comment in existing files. People find it in
  `.paqad/.config.example` and `paqad-ai config show`. A second run writes nothing. It names (and
  leaves untouched) a file that isn't valid YAML or isn't a map, and a file with a higher
  `schema_version`. `update` never writes a default as a live value, so a new setting's default
  reaches the team through the code. A retired value (`retiredValueMap` in
  `src/core/team-config-values.ts`) is replaced with its current value and gets one line in the
  update output. Until then paqad reads it as the current value and doesn't report it as invalid.
  `legacy_existence_check: strict` is the only one so far and becomes `warn`, because that check
  never blocks a change.
- Explicit writes still re-render. `paqad-ai config set` and the other single-value writers render
  the whole file they touch, so one change can bring in reworded comments and newly added settings.
- There are 17 team files: 12 of paqad's own and 5 under `git-workflow/`. `src/core/team-file-schema.ts`
  owns `schema_version`. Each frozen file carries a whole number that changes only when its layout does:
  `schema_version` in team files, `# catalog_version:` on line 2 of `.paqad/.config.example`,
  `LAUNCHER_REVISION` in `.paqad/hook.mjs` and `# managed_block_version:` in the managed
  `.paqad/.gitignore` block. A file with a higher number than this paqad knows is left alone, with a
  line saying to update paqad. The launcher is also rewritten when its revision is lower or missing, or equal
  with different content.
- The first update swaps the line once. It prints a line asking one person to commit the swap, together
  with the git-workflow record when that file exists, then teammates update. Everyone needs this version or newer, including the
  plugin inside sessions, because a lagging plugin binary comes first on the PATH there. Released versions
  from 1.119.0 back don't know the new numbers, so they can overwrite these files.
- Other writers respect a higher number too. The delivery migration, `git-workflow setup --overwrite` and
  a dashboard save refuse a git-workflow file with a higher `schema_version` and print the newer-file line.
  The migration leaves the old policy file in place. A malformed stamp in any of the 5 git-workflow files
  also stops a pending move, meaning those files hold no settings yet. Update names that file on each run until it is fixed, and the old policy file stays.
  While the move is stopped, update and onboarding create none of the missing git-workflow files, so the move
  runs on the next update once the stamp is fixed.
- `config set` and the other single-value writers, and the settings migration, refuse one of paqad's own team
  files whose `schema_version` or `paqad_version` line can't be read (`renderWriteBlock`), with the
  message in `api.md`. A write to `git-workflow/commits.yaml` keeps that line and goes ahead, because
  it never re-renders the file. Update's sync skips the stamp swap on such a file.
- When a hook paqad writes can't be made executable, update adds a note and doesn't fail, onboard adds a
  warning, and `join` and `delivery-link install` print the same line on stderr.
- A retired setting's commented copy is deleted only when it sits under its own group, and its note only when
  that note is right above it, so a team comment that looks like a removed setting stays.
- To go back, revert the swap commit and install the older paqad.
- A project already on 1.119.0 is not repaired. It keeps the duplicate `ai_attribution` comment in
  `commits.yaml` and the changed-outside warning from doctor. The way out, after asking the team, is
  `paqad-ai git-workflow check --accept`. A clean re-run of the update from a start before 1.119.0
  doesn't produce them.
- Eleven settings nothing read are gone: `research_depth`, `full_lane_default`,
  `require_adversarial_review`, `block_on_stale_docs`, `require_db_review_for_migrations`,
  `escalate_destructive_operations`, `escalate_risky_migrations`, `escalate_security_findings`,
  `escalate_db_row_threshold`, `decisions_max_screens_per_task` and
  `decisions_idle_timeout_minutes`. `src/core/team-config-retired.ts` removes a live line once and
  says so, and doctor doesn't report those paths as unknown. `feature-development/safety.yaml` goes
  with them: update deletes it, or keeps it and says so when it holds notes the team wrote.
- paqad treats two kinds of hooks folder as hand-edited and never writes to them: a folder git tracks, and any
  `.husky/_` holding the runner file `h`, tracked or not. `trackedWorkflowHookAdvice`
  (`src/feature-evidence/git-hooks.ts`) prints the exact lines to add to `commit-msg` and `pre-push`,
  or the `chmod` step when the line is there but git can't run the file. For husky it names
  `.husky/commit-msg` and `.husky/pre-push`, because a husky reinstall rewrites `.husky/_` and lines added
  there never run. Lines an older paqad appended to `.husky/_` stay untouched and don't count as installed,
  and a reinstall wipes them. The executable bit isn't needed under husky, so the advice there gives only the lines, with no shebang or
  `chmod` step. Both lines start with
  `if command -v paqad-ai`, so someone with only the plugin who commits from a plain terminal skips the
  check, even after doctor has gone green. This limit is accepted, and the advice says so.
- After the rule cleanup, update repairs a kept rule line that points at a deleted file when paqad
  shipped that line, names a line the team wrote (`<file> still mentions <path>`), and recompiles
  stale rules. A failed refresh prints a line pointing at `paqad-ai rag refresh-context`.
- After the move, `.paqad/configs/.config.app` is a stub whose first line is `# paqad-migrated-stub`.
  It holds `paqad_enable=false` and `minimum_version` for an older paqad, which turns itself off
  instead of running on defaults.
  A stub already on disk can keep older wording, because update doesn't rewrite it. Every current reader (the CLI, the
  shell and Node hooks, the plugin mod and the team launcher) skips a file with that first line,
  so a current paqad stays on. The stub is written last, after the YAML files and the workflow
  view, so a failed write leaves the old `.config.app` in place. The move is roll-forward only: no command
  restores the old files, so a bad release is fixed by the next release or `PAQAD_DISABLED=1`.
- `src/core/shipped-workflow-entries.ts` lists a hash of every instruction and read path paqad has
  shipped, per stage, in the shape of `OBSOLETE_WORKFLOW_RULES`. Text is hashed with whitespace
  runs collapsed and trimmed, and the stage is part of the key, so a paqad wording a team moved to
  another stage stays. `planWorkflowCarry` drops a listed entry when it migrates an old workflow
  file, and `syncTeamConfigFiles` removes one from `feature-development/workflow.yaml`, after the
  newer-checkout and stamped-version guards and before the render compare, so a file stamped by a
  newer paqad is never edited and a second run writes nothing. A list left empty loses its key and
  renders as the commented default, and a team comment on a removed line moves to the team notes.
- The hash list is a committed literal because shallow CI clones have no history. To refresh it,
  run `node scripts/shipped-workflow-hashes.mjs` with full git history and paste its output into
  the list. It reads every commit of `src/pipeline/feature-development-policy.ts`, both the stage
  objects and the embedded `stages:` template of older commits, and stops on an element it can't
  resolve. A guard test fails and prints the hash to add when a current default isn't on the list.
- `src/update/last-update.ts` stays light because SessionStart loads it through a caught dynamic
  import of `dist/update/last-update.js`, so an older dist costs only the line. It imports the
  updater for types only. The session line is built only from versions matching a version pattern
  and a count, so text in a hand-edited record can't reach agent context. The record is written
  before `appendAuditLog`, so an audit failure can't lose it, and a failed write never fails the
  update. The hook renames the record first and adds the line only if the rename worked, so
  concurrent sessions show it once and a failed rename keeps the record.
- The merge is an unlocked read then write, so two background runs at the same moment may lose one
  record's lists. A background update that fails partway writes no record: the failure stays in the
  audit log, and `--last` may show an older update. `silent-update.mjs` passes `cwd: projectRoot`
  to its spawn so the record lands where the reader looks.
- After the cleanups, `withoutRemovedRetiredFiles` drops a `generated_artifacts` entry only when its
  path is on the retired set (the `OBSOLETE_WORKFLOW_RULES` paths under `docs/instructions/rules`,
  the old delivery policy and the old workflow view) and the file is absent. The manifest is written
  again only when an entry dropped, keeping the resolved `providers`. Any other missing file keeps
  its entry, and so does a file a cleanup couldn't remove, so the same rule covers a fresh upgrade
  and a project that was already upgraded.
- `syncGitWorkflowFile` only swaps `paqad_version` for `schema_version`. A new `commits.yaml` gets the
  commented `ai_attribution` lines from its default render, and an existing one isn't changed for them.
  `syncGitWorkflow` refreshes the last-applied hash of a swapped file unless that file had already
  changed outside the skill, so the swap itself never causes the changed-outside warning.
- The stage agents are written here too, because an upgraded machine goes through
  `paqad-ai update --silent` and never reaches the onboarding path that wrote them. This is
  best-effort, since the agents are inert until dispatched.
