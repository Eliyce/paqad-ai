# Pack Schema (pack.yaml) — Technical View

> Module: **Pack System** (`pack-system`) · Layer: `framework-internals` · Feature slug: `pack-schema`

## Module Boundaries

Source directories owned by this feature:

- `src/packs`



## Entry Points

- Imported by other paqad-ai modules — see the source list above for the public surface.

## Data Model / Schema

- `pack.yaml` is validated against `src/validators/schemas/stack-pack.schema.json` (closed: an
  unknown top-level key is an error), then by the checks in `src/packs/loader.ts`. The manifest
  type is `StackPackManifest` in `src/core/types/pack.ts`.
- `build_outputs` (optional, list of strings): the project-relative folders the pack's build
  writes. `paqad-ai checks run` fingerprints their files after a green build and reuses a build
  only while the fingerprint matches (see [`check-runner`](../../../verification/check-runner.md)).
  The loader reports an error for an absolute path, a drive-letter path or a path with a `..`
  segment. The react and node-service packs declare `dist`.
- `format_changed` (optional, list of `{ default_command, script, command }`, all three non-empty
  strings, no other keys): a formatter that can run on the changed files only. `checks run` uses
  `command` instead of the profile's format command only when that command equals
  `default_command` exactly and `package.json` `scripts.format` equals `script` exactly. The
  loader reports an error when `command` does not hold `{files}` exactly once as its own argument,
  and when two entries share a `default_command`. The react and node-service packs declare
  `pnpm format` → `pnpm exec prettier --write --ignore-unknown {files}` and `npm run format` →
  `npx --no-install prettier --write --ignore-unknown {files}`, both for the script
  `prettier --write .`.

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

- Unit test files that cover `pack-schema` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).
