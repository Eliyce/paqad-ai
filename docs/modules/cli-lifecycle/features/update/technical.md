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
  `writeGitignore` and `writeWorktreeInclude`, the same writers onboarding uses. An upgraded
  project therefore gains ignore lines a newer paqad added (for example
  `.agent-entry-loaded.d/`) without being onboarded again.
- `writeGitignore` rewrites only the managed block of `.paqad/.gitignore`, between the paqad
  markers. Every line outside the block is kept. The managed block always lists `vectors/`,
  whatever the RAG setting.
- `writeWorktreeInclude` adds the one `.paqad/.config` line to the repo-root `.worktreeinclude`
  when it is missing and keeps every other line, so a new Desktop worktree gets the developer's
  local config.
- When the checkout was stamped by a newer paqad (`checkoutIsNewer`), the ignore file is left
  alone, the same rule the tracked config follows, so an older install never drops lines a
  newer one added.
