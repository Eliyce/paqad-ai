# rag init — Technical View

> Module: **RAG Index Commands** (`cli-rag`) · Layer: `cli-commands` · Feature slug: `rag-init`

## Module Boundaries

Source directories owned by this feature:

- `src/cli/commands/rag.ts`



## Entry Points

- CLI entry: `paqad-ai rag init` (verify exact flag set in the source).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `cli-commands` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- `createRagCommand()` registers the `rag` command family.
- `initializeRagIndex(projectRoot, options)` is the shared initial-build and recovery path used by both `rag init` and `paqad-ai join`.
- Callers may supply the already-read RAG status plus provider and model, avoiding duplicate status work while retaining the normal provider recovery behavior.

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

- Unit test files that cover `rag-init` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).
