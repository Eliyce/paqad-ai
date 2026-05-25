# S-17 — Windows CI full restoration

**Tracks:** [Eliyce/paqad-ai#17](https://github.com/Eliyce/paqad-ai/issues/17)
**Lane:** graduated
**Created:** 2026-05-25

## User Story

As a maintainer of `paqad-ai`, I want the Windows CI leg (`Node 22 / windows-latest`) to pass on every PR so I can put it back into branch protection's required contexts — preventing future cross-platform regressions from reaching `main`.

## Current state (verified 2026-05-25 against main @ `c7aac12`)

15 test files fail on Windows. Categorized:

### Path-normalization failures (~13 files)

Production code emits Windows-native backslash paths into user-facing fields (return values, JSON manifests, log strings) and Linux/macOS path-shaped assertions fail. Pattern established in rounds #30 and #33: wrap output boundaries with `toPosixPath` from `@/core/path-utils.js`.

Affected test files (suspected source modules in parens):

- `tests/e2e/onboarding.e2e.test.ts` (`src/onboarding/orchestrator.ts`)
- `tests/unit/cli/compliance.test.ts` (`src/cli/compliance.ts`)
- `tests/unit/compliance/index-store.test.ts` (`src/compliance/index-store.ts`)
- `tests/unit/coverage-focused/ci-coverage-gaps.test.ts`
- `tests/unit/document/workflow.test.ts` (`src/document/workflow.ts` — more spots beyond `findOrphanedModuleDirs`)
- `tests/unit/onboarding/orchestrator.test.ts` (`src/onboarding/orchestrator.ts` inner writers, `src/onboarding/reference-generator.ts` upstream)
- `tests/unit/pentest/shared.test.ts`
- `tests/unit/pipeline/lane-runner.test.ts` (`src/pipeline/lane-runner.ts`) — except the one custom-workflow case (non-path bug)
- `tests/unit/planning/planning-ops.test.ts`
- `tests/unit/project-knowledge/evidence-retriever.test.ts`
- `tests/unit/rag/file-filter.test.ts`

### Non-path bugs (2 files / 2 cases)

- `tests/unit/patterns/patterns.test.ts` — non-deterministic Map iteration ordering. Production code relies on insertion order in a place where insertion order differs across platforms. Not a path issue.
- `tests/unit/pipeline/lane-runner.test.ts > runs custom workflow templates` — returns `'request-classification'` instead of `null`. Suspected: workflow template lookup falls through to a default classifier on Windows due to a separator-sensitive comparison or template-discovery path.

## Acceptance Criteria

1. `Node 22 / windows-latest` job completes successfully on a fresh CI run against the change branch.
2. All required CI contexts (`Node 22 / ubuntu-latest`, `Node 24 / ubuntu-latest`, `Node 22 / macos-latest`, `CodeQL`) remain green.
3. Branch protection on `main` updated to include `Node 22 / windows-latest` in `required_status_checks.contexts` once the Windows leg is green on at least 3 consecutive merges.
4. No production-code path uses `toPosixPath` inside `path.join` / internal call sites — only at output boundaries (return values, JSON, log strings, console output).
5. The two non-path bugs are fixed at root cause, not by skipping or platform-conditional test guards.
6. A changeset is added covering the runtime-behavior changes (path normalization is user-visible in output).
7. Issue #17 closed with link to merged PR(s).

## Test Plan

- Per-fix: run the specific test file locally on macOS first (`pnpm vitest run <path>`) to confirm green.
- Pre-push: run full `pnpm test` locally (3124 baseline). All passing.
- Pre-push: run `pnpm run lint` and `pnpm run typecheck`. Clean.
- CI: confirm all required contexts pass; confirm Windows leg passes.
- Post-merge: monitor 3 subsequent PR Windows runs to confirm stability before adding to required contexts.

## Out of scope

- Refactoring path handling beyond output-boundary normalization.
- Touching internal `path.join` call sites.
- Reworking the Windows test setup (timeouts, excludes) — that landed in #28.
