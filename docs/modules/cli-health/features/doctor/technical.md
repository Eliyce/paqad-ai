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
