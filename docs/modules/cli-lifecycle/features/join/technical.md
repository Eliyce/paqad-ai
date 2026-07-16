# paqad-ai join — Technical View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `join`

## Entry Point

`src/cli/commands/join.ts` registers `paqad-ai join` with `--project-root`, `--interactive`, `--no-rag`, and `--yes` options. The default path is non-interactive.

## Inputs and State

- Reads `.paqad/onboarding-manifest.json` to recover the primary adapter and every provider represented by generated artifacts.
- Reads `.paqad/project-profile.yaml` with migration persistence disabled.
- Resolves current rules, MCP, cache, and memory artifacts from the recorded profile.
- Reads effective RAG configuration through the normal precedence chain: environment, `.paqad/.config`, tracked group configuration, profile, defaults.

## Writes and Safety

Adapter-generated candidates are limited to missing paths that pass `git check-ignore --no-index`. Compiled rules, session context, vector and decision directories, framework version, and the agent-entry sentinel each have the same ignored-path gate. Git hooks are stored beneath Git metadata and use the existing idempotent chaining installer.

`readProjectProfile(projectRoot, { persistMigration: false })` prevents join from rewriting a legacy tracked profile. The clone-level E2E test asserts `git status --porcelain` remains empty after the command.

## RAG Behavior

Disabled RAG exits the RAG step without work. A present, valid index is retained. A missing or invalid index is built through the exported `initializeRagIndex` path shared with `rag init`, using the team-selected provider and model after higher-precedence overrides.

## Tests

- `tests/unit/cli/join.test.ts` covers flags, guards, provider derivation, ignored-only writes, tracked-file preservation, RAG precedence, valid-index reuse, and interactive confirmation.
- `tests/e2e/join.e2e.test.ts` exercises a fresh Git clone and proves a zero tracked diff.
- `tests/unit/cli/rag.test.ts` covers the shared build and recovery behavior.
