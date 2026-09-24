# paqad-ai join — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `join`

## Entry Point

`src/cli/commands/join.ts` registers `paqad-ai join` with `--project-root`, `--interactive`, `--no-rag`, and `--yes` options. The default path is non-interactive.

## Inputs and State

- Reads `.paqad/onboarding-manifest.json` to recover the primary adapter and every provider represented by generated artifacts.
- Reads `.paqad/project-profile.yaml` with migration persistence disabled.
- Resolves current rules, MCP, cache, and memory artifacts from the recorded profile.
- Reads effective RAG configuration through the normal precedence chain: environment, `.paqad/.config`, tracked group configuration, profile, defaults.

## Global Install

Join calls `bootstrapFrameworkHome()` (`src/install/bootstrap.ts`) before recreating local artifacts. This is the home-only half of `bootstrapFramework`: it creates the `~/.paqad-ai/current` framework symlink and writes the six stage-isolation agents under the user home, and writes nothing into the project. `bootstrapFramework` (used by `onboard`/`install`) layers the project-side metadata writes on top. The step is best-effort.

## Per-Machine Artifacts

`regenerateMachineArtifacts()` regenerates the Git-ignored artifacts a clone does not carry, each best-effort: the detection report (`Detector.detect` + `writeDetectionReport`), the stack snapshot and drift (`StackIntrospector.snapshot` + `writeStackArtifacts`), the code-knowledge index (`buildCodeKnowledgeIndex` + `writeCodeKnowledgeIndex`, index only, not the tracked `docs/instructions/registries/` side artifacts), delivery detection (`runDeliveryDetection`), and the quality baseline (`collectQualityMeasures` + `createBaseline` + `writeQualityBaseline`, seeded from the clean HEAD, only when absent). `onboard` also builds the code-knowledge index.

## Writes and Safety

Adapter-generated candidates are limited to paths that pass the ignore gate (`isGitIgnored`), which now guards with `git ls-files --error-unmatch` first so a tracked file matching an ignore pattern is never treated as ignored, and are regenerated even when present so a stale host config is refreshed. Compiled rules, session context, vector and decision directories, and the framework version each have the same ignored-path gate. The framework version is seeded at the epoch (`1970-01-01T00:00:00Z`), matching `silent-update.mjs`, so the next session's update check fires immediately. The dead agent-entry-sentinel write was removed (SessionStart deletes the sentinel every session). Git hooks use the idempotent chaining installer; when `core.hooksPath` points at a tracked directory, `installGitHooks` writes nothing and returns a `trackedHooksDir`/`snippet` for join to print.

`readProjectProfile(projectRoot, { persistMigration: false })` prevents join from rewriting a legacy tracked profile. The clone-level E2E test asserts `git status --porcelain` remains empty after the command.

## RAG Behavior

Disabled RAG exits the RAG step without work. A present, valid index is retained. A missing or invalid index is built through the exported `initializeRagIndex` path shared with `rag init`, using the team-selected provider and model after higher-precedence overrides. Join passes `buildOnly: true`, so `RagService.buildIndexOnly` rebuilds the index without `writeProjectProfile` or `syncFrameworkConfig`; the tracked profile and dev-local `.config` are left untouched.

## Tests

- `tests/unit/cli/join.test.ts` covers flags, guards, provider derivation, ignored-only writes, tracked-file preservation, RAG precedence, valid-index reuse, and interactive confirmation.
- `tests/e2e/join.e2e.test.ts` exercises a fresh Git clone and proves a zero tracked diff.
- `tests/unit/cli/rag.test.ts` covers the shared build and recovery behavior.
