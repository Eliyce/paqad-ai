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

## Why the `src/health/` code works the way it does

- **Not required on purpose.** `framework-version.txt` is per-machine and git-ignored (the
  silent-update hook recreates it), so a teammate who cloned an onboarded repo is healthy without
  it. The decisions audit log is git-ignored telemetry with no reader, so a clean clone is healthy
  without it too. An absent module-profiles folder on a quiet project is expected.
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
