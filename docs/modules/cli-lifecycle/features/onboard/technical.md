# paqad-ai onboard — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `onboard`

## Module Boundaries

Source directories owned by this feature:

- `src/cli/commands/onboard.ts`
- `src/onboarding`



## Entry Points

- CLI entry: `paqad-ai onboard` (verify exact flag set in the source).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `cli-commands` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- RAG enablement, provider, and model are written through `setGroupConfigValue` to the tracked `.paqad/configs/.config.rag` group file. The writer activates generated commented defaults in place and preserves file ordering.
- `writeOnboardingManifest` normalizes persisted paths and deterministic collections before serialization. When semantic content is unchanged, it carries forward both `generated_at` and `detected.timestamp` and avoids rewriting byte-identical output.
- Detection signals and generated artifact paths are repository-relative; ignored repository paths omit `.DS_Store`, `.idea`, and `.vscode` noise and are sorted.

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

- Unit test files that cover `onboard` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## RAG at onboarding

- When the lead turns RAG on with the local provider and the embedding engine is missing (the
  plugin case), onboarding keeps `rag_enabled=true`, starts the background engine install with
  the project root (`ragEngineInstallingInBackground` in `src/onboarding/rag-onboarding.ts`) and
  prints one line: "search index is installing in the background; text search until it is
  ready". The index is built by the installer once the engine is in place.
- When the install cannot start (for example no `CLAUDE_PLUGIN_DATA`, or a recent failed
  attempt) onboarding tries the build as before. Any build failure turns RAG off and says so:
  "RAG was turned off: <reason>". The setting is never flipped without that line.
