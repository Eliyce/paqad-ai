# paqad-ai doctor — Technical View

> Module: **Health & Diagnostics Commands** (`cli-health`) · Layer: `cli-commands` · Feature slug: `doctor`

## Module Boundaries

Source directories owned by this feature:

- `src/cli/commands/doctor.ts`



## Entry Points

- CLI entry: `paqad-ai doctor` (verify exact flag set in the source).

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

- Unit test files that cover `doctor` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## RAG lines

- `RAG engine installed` reads "not ready: installing ..." while the background engine install
  runs, then passes once the engine resolves.
- `RAG model cache present` checks `~/.paqad/models/<model>` through the shared
  `localModelDir`, with the model resolved the way the provider resolves it.
- `RAG vector gitignore present` asks `git check-ignore` about `.paqad/vectors/` with its
  trailing slash. The managed `.paqad/.gitignore` lists `vectors/` as a directory pattern, and
  git only matches that pattern for a path that is a directory. Before the folder exists, the
  slash is what tells git it is one.

## Tracked session sentinels

- `Session sentinels untracked` runs `git ls-files -- .paqad/.agent-entry-loaded.d`. The folder
  holds one entry sentinel per session and is ignored by the managed `.paqad/.gitignore`, but a
  file committed before that ignore line existed stays tracked and dirties the tree every
  session. When git tracks any file there, doctor warns and gives the fix:
  `git rm -r --cached .paqad/.agent-entry-loaded.d`, then commit.

## Team settings (`team-config`)

- `teamConfigHealth` (`src/health/team-config-check.ts`) runs when `.paqad/configs/` exists and
  returns one row per problem, or one pass row. Every row is a warning except the old-files row
  after the read window.
- A missing team file (only once the project is migrated):
  `.paqad/configs/<file> is missing. Run paqad-ai update to create it.`
- Each invalid value and each file that isn't valid YAML, with the same text session start and
  `config show` print (`readTeamConfig().issues`, legacy lines left out).
- A setting set under a group line that is still commented out (`kind: 'repaired'`). paqad reads
  the value anyway and names both lines:
  `<file> line <n>: <key> is set, but the # is still in front of <group>: on line <m>. paqad reads <key> anyway; remove the # in front of <group>:.`
- A key no setting owns, per file (`unknownTeamConfigSettings`), with structured settings such as
  `stages.<stage>.read` and `commands.extra` treated as known:
  `<file> has a setting paqad doesn't know: <path>. It may be from a newer paqad or a typo.`
- An old `.config.*` file that still holds set lines:
  `Old settings in .paqad/configs/<file> should be moved. Run paqad-ai config migrate.` It warns
  inside the read window. It fails only when this paqad was released after
  `LEGACY_TEAM_CONFIG_READ_UNTIL` (`releasedAfterLegacyWindow`), so a machine whose clock passes
  the date on an older release never starts failing on its own.

## Running version (`paqad-ai version`)

- `runningVersionHealth` (`src/health/running-version-check.ts`) warns when the running `paqad-ai` is older
  than `.paqad/framework-version.txt`:
  `This paqad-ai is <running>, but this repo was last updated with <repo> on this machine. <advice>`
- The advice is `Run npm i -g paqad-ai@latest.`, or for a plugin binary, the plugin update command
  and a reminder to start a new session, because the session's PATH still points at the old one.
- Git ignores that file, so the check knows only about updates run on this machine. If a teammate committed
  an update and you never updated here, you get no warning.
- The `git-workflow` check treats a tracked hooks folder and any `.husky/_` holding the runner `h`, tracked or
  not, as hand-edited, and gives the lines to add. On a husky runner folder the advice reads "which husky runs"
  instead of "which your repo tracks", and names `.husky/commit-msg` and `.husky/pre-push`.
  Lines an older paqad appended to `.husky/_` don't count as installed, because they never run.
- The `git-workflow` check says to keep the old delivery file only while a move is pending, meaning the file exists
  and the 5 git-workflow files hold no settings yet. With a newer or unreadable stamp in the way it says
  `<policy file> hasn't moved yet, so keep it. <the file's line> The move runs on the next paqad-ai update.`. With
  nothing in the way it says `<policy file> hasn't moved yet, so keep it. It holds your only copy of these rules. Run
  paqad-ai update to move them.`. With no move pending it says `<policy file> is no longer read. Delete it.`, followed
  by the line of any file with a bad stamp.
- Doctor checks entry files only for the providers the project uses.
- A project already on 1.119.0 keeps the changed-outside warning for its git-workflow files. The way out,
  after asking the team, is `paqad-ai git-workflow check --accept`.

## Why the `src/health/` code works the way it does

- **Not required on purpose.** `framework-version.txt` is per-machine and git-ignored (the
  silent-update hook recreates it), so a teammate who cloned an onboarded repo is healthy without
  it. The decisions audit log is git-ignored telemetry with no reader, so a clean clone is healthy
  without it too. An absent module-profiles folder on a quiet project is expected.
- **Named-field message.** `checkJsonArtifact` names the field and value of a failure, such as
  `detected_stack: node-cli isn't an allowed value`, with a dotted path when nested
  (`detected.detected_stack: ...`). Other failures print `<field>: <message>`. The `anyOf` and
  `must be null` errors that the manifest's `$ref` adds are dropped, because they name nothing the
  developer can fix. Ajv stops at the first failure, so a file with two bad fields names one per
  run. `detection-report.schema.json` holds its own copy of the stack list, and a test checks every
  value in `STACKS` against it.
- **Git-ignore check.** Doctor asks `git check-ignore`, which honours the root `.gitignore`, the
  nested `.paqad/.gitignore` and global excludes. Exit 0 means ignored and exit 1 means not; any
  other status (not a repo, no git) falls back to reading both ignore files, so the check works
  before `git init`.
- **Warn, not fail.** A Codex project with missing or partial `.codex/hooks.json` warns and names
  the `/hooks` trust step, since doctor cannot see from disk whether Codex trusted the hooks. Edit
  gates without `onFailure: "block"` (an older onboarding) warn, since the old config still
  enforces through exit 2; the pre-mutation capability gate is told apart from its completion
  entry by its ` pre-mutation` argument. A missing or dangling framework link warns, since the
  plugin re-points it at the next session start and an npm reinstall fixes the npm case. A
  `.paqad/` layout from a newer paqad warns with the update line; an older one is a normal
  migration. The embedding engine missing in the plugin warns, since retrieval falls back to text
  search.
- **Pass or fail on purpose.** A deliberate disable (the profile flag or `PAQAD_DISABLED`) is
  reported as a pass, which is how it is told apart from an accidental uninstall. A stale compiled
  rule store fails, because the agent would be served rule text that drifted from the rules on
  disk. A pickable expert without a lens file fails, because it is a packaging gap; the other
  roster problems warn, and a default value never warns.
- **Information only.** MCP servers are a recommendation, never a pass or warning, because paqad
  writes no MCP config and cannot judge it; an unreadable `.mcp.json` is reported as not found.
  The spec-pipeline switches show their value and where it came from, read from the same resolver
  `config effective` uses. An `info` check never moves the overall status.
- **`plugin-install.ts`.** A runtime path under Claude Code's plugin cache is the plugin, checked
  before `node_modules`, so a plugin inside `node_modules` still reads as the plugin. When the
  plugin is installed, the updater skips the Claude-specific writes the plugin owns, so they are
  never wired twice.
- **`provider-entry-contract.ts`.** An entry file must be a lean stub that points at the bootstrap
  and inlines no contract; an older fat entry file (with a Decision Pause Contract or a "paqad in
  your chat" section) is flagged so a refresh restores the stub. Every entry file must carry the
  same fallback clause so a missing or disabled paqad never breaks the host.

## Discovery plugin next to the paqad plugin

`discoveryPluginClash` in `src/health/plugin-install.ts` reads only files: an
`installed_plugins.json` key starting `paqad-product-discovery@`, or a folder under the Claude
config `plugins/synced/` whose `.claude-plugin/plugin.json` is named `paqad` with no `hooks`,
together with the paqad plugin (`paqad@eliyce`, or a synced `paqad` folder with hooks). Missing or
unreadable files mean not installed. When both are present doctor adds a failing "Claude plugins"
check with the one sentence in `DISCOVERY_CLASH_MESSAGE`; otherwise it adds no row. `paqad-ai update`,
`paqad-ai install` (on stderr, after its JSON result) and `paqad-ai onboard` print the same sentence
as a warning. It never relies on a paqad hook. The
same clash in Codex is not detected while paqad ships no Codex plugin named `paqad`.
