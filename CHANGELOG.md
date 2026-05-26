# paqad-ai

## 1.2.1

### Patch Changes

- [#65](https://github.com/Eliyce/paqad-ai/pull/65) [`f398b00`](https://github.com/Eliyce/paqad-ai/commit/f398b00ced1d676a5e35452a3da7d143431569a0) Thanks [@HLasani](https://github.com/HLasani)! - Fix `paqad-ai onboard` hanging on the RAG "No, skip" path at the end of the full interactive prompt chain.

  The orchestrator previously interleaved the RAG inquirer prompt with file writes: `resolveRagSelection()` ran early, and `writeDetectionReport` / `writeFrameworkMetadata` / `writeOnboardingManifest` / `writeDecisionPauseContractDocument` / `compileRules` / `initializeModuleHealth` / `classifier-config.json` / `next-steps.md` all ran _after_ it. When inquirer left a stuck readline handle on Node's event loop — observed reliably with the full prompt chain on the No-skip branch — every post-RAG write was silently dropped. Users were left with an incomplete `.paqad/**` and no `ONBOARDING COMPLETE` banner.

  Onboarding is now two-phase. Phase 1 writes every core `.paqad/**` artifact and `CLAUDE.md`-equivalents with no inquirer prompts in the path. The new `onPhase1Complete` callback fires only after the onboarding manifest is on disk, so the success banner prints before phase 2 begins. Phase 2 owns the RAG opt-in (prompt → optional index build → idempotent `writeProjectProfile` update). If phase 2 prompts, hangs, fails, or is interrupted, every phase 1 artifact is already durable on disk.

  Adds three orchestrator invariant unit tests that pin the new contract (`onPhase1Complete` fires after all core artifacts exist; a thrown `RagService.configureAndBuild` does not drop core writes; a thrown `resolveRagSelection` does not drop core writes) and a PTY-driven E2E (gated on the system `expect(1)` binary, skipped on platforms without it) that drives the real built CLI through the full interactive Laravel prompt chain, picks "No, skip" on RAG, and asserts the complete `.paqad/**` artifact set on disk.

  Closes [#62](https://github.com/Eliyce/paqad-ai/issues/62).

## 1.2.0

### Minor Changes

- [#60](https://github.com/Eliyce/paqad-ai/pull/60) [`2e35581`](https://github.com/Eliyce/paqad-ai/commit/2e355817f14792fc51b7beada9001f96eaac4b13) Thanks [@HLasani](https://github.com/HLasani)! - **[#37](https://github.com/Eliyce/paqad-ai/issues/37) — Decision Pause Contract: ship the full resolution flow to every provider via one managed external doc**
  - Onboarding now writes a canonical `.paqad/decision-pause-contract.md` (rule, categories sourced from `DECISION_CATEGORIES`, four-step resolution flow, per-adapter UI table, file-wait fallback) — re-runs are byte-identical when nothing changed.
  - Every provider entry file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/…`, `.windsurf/rules/…`, `GEMINI.md`, `.junie/AGENTS.md`, `ANTIGRAVITY.md`, `.github/copilot-instructions.md`, `.continue/…`, `.aider.conf.yml`) now renders a thin pointer + a one-sentence per-adapter UI note (Claude Code → `AskUserQuestion`, Aider → `/ask`, etc.) from the new `decision-pause-ui-shim`.
  - `paqad refresh --providers` re-renders entry files for adapters whose config exists on disk and rewrites the managed doc; it intentionally does not silently onboard new providers.
  - Health check now compares each entry against its adapter's expected rendering and warns when the managed doc is missing, with a remediation hint pointing at `paqad refresh --providers`.

  **[#42](https://github.com/Eliyce/paqad-ai/issues/42) — `ticket_intake` + `delivery` bookend stages with priors-first decision elicitation**
  - New stage order: `ticket_intake → planning → specification → development → review → checks → documentation_sync → delivery`. Both bookends are framework-owned and project-overridable via the existing `merge_mode: append` mechanism; the JSON schema rejects unknown keys with `additionalProperties: false`.
  - New optional top-level `conventions:` block on the project profile covering `ticket / intake_decisions / branch / commit / pr`. `DEFAULT_CONVENTIONS` is the runtime source of truth; `resolveConventions` shallow-merges project overrides per section so every field is populated for downstream consumers.
  - `mcp.servers[]` gains an optional `kind` discriminator (`jira | linear | github-issues | generic`); existing servers without `kind` keep validating.
  - Four new `DECISION_CATEGORIES`: `intake.requirement`, `intake.confirm_auto_resolution`, `intake.write_back`, `delivery.open_pr`. All ride the existing pending → resolved lifecycle, audit log, and TTL machinery.
  - `findIntakePriorMatch` is the dedicated priors-first entrypoint for intake; it computes the fingerprint and reuses the existing `DecisionStore.findReusableDecision` machinery, which already emits `decision-reused` audit events on every hit.
  - New batched-confirm primitive (`BatchedConfirmRequest`, `applyBatchedAnswer`, `renderBatchedRow`) backs `intake.confirm_auto_resolution`. Single-packet flow remains the default for every other category.
  - New `src/delivery/` modules: `templates.ts` renders branch / commit / pr_title / pr_body from the conventions block + inputs (slugify, conventional type mapping, `{placeholder}` substitution); `host.ts` detects the delivery host (GitHub today, GitLab / Bitbucket recognised); `runner.ts` sequences `git checkout -b → git commit → git push → gh pr create` through a dependency-injected `DeliveryShell` so unit tests don't touch a real remote. Every failure short-circuits with an actionable remediation hint — no silent local-only fallback.
  - Default PR body template at `runtime/templates/pr-body.md.hbs`; projects can override with `.paqad/templates/pr-body.md`.
  - Module docs: `docs/modules/decision-pause-contract/managed-doc-architecture.md` and `docs/modules/feature-development-workflow/ticket-intake-and-delivery.md`.

## 1.1.0

### Minor Changes

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Add a harness-enforced agent-entry gate so onboarded Claude Code projects can't silently bypass `CLAUDE.md` ([#34](https://github.com/Eliyce/paqad-ai/issues/34)). Onboarding now writes `.claude/settings.json` with two hooks:
  - `PreToolUse` on `Edit|Write|NotebookEdit` runs `runtime/hooks/agent-entry-gate.sh`, which blocks the call with exit code 2 unless `.paqad/.agent-entry-loaded` exists and is newer than `CLAUDE.md`, `.paqad/framework-path.txt`, and everything under `docs/instructions/`.
  - `SessionStart` runs `runtime/hooks/agent-entry-session-start.sh`, which deletes the sentinel so every new session starts ungated.

  The CLAUDE.md template now instructs the agent to write the sentinel after loading the framework entry, and to re-load when the gate invalidates it. Existing settings.json keys and pre-existing hook entries are preserved on merge, and re-running onboarding is idempotent (no duplicate gate entries). Read-only tools (Read, Grep, Glob, status-only Bash) remain available pre-gate so the agent can satisfy it. AGENTS.md and other providers can re-use the same scripts in follow-ups via `PAQAD_ENTRY_FILE`.

### Patch Changes

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Make onboarding re-runs idempotent ([#27](https://github.com/Eliyce/paqad-ai/issues/27)): when `.paqad/detection-report.json`, `.paqad/onboarding-manifest.json`, and `.paqad/framework-version.txt` would otherwise be byte-identical apart from their embedded timestamp, the writer now reuses the existing timestamp instead of stamping a fresh one. A no-op re-run produces zero diff; any real change still bumps the timestamp. Fixes the Windows-CI `is idempotent across repeated onboarding runs` failure (timing luck was hiding the same bug on macOS/Linux).

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - `paqad-ai refresh` now self-heals when `docs/instructions/architecture/design-tokens.json` is missing ([#56](https://github.com/Eliyce/paqad-ai/issues/56)). The design-system step seeds default tokens via the existing idempotent `DesignTokenService.seed()` before generating docs and theme exports, so `--stack` and `--context` sub-refreshes no longer get aborted by an unhandled `ENOENT`. `DesignTokenService.load()` now translates a missing file into a typed `DesignTokensMissingError` with an actionable message; invalid (but present) files still surface the existing validation error.

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Stop emitting the hardcoded `Categories:` block in provider entry files ([#54](https://github.com/Eliyce/paqad-ai/issues/54)). `buildDecisionPauseContractSection()` now renders just the Decision Pause Contract paragraph — no `Categories:` heading, no fixed five-item bullet list. `extractDecisionPauseContractSection` still parses entry files that previously contained the block (back-compat), and the existing drift health check flags the legacy block so re-running onboarding / refresh strips it from already-onboarded projects.

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Cross-platform output consistency: normalize path strings to forward slashes at more production output boundaries — DocumentationWorkflow generated/skipped arrays and handover_path, onboarding orchestrator manifest writes and return values, `saveObligationIndex` return, registry-generator source_paths (both native-module and signal-extracted), and the project-question phase write target. Fix `slugifySpec` to split on both `/` and `\\` so spec-indexed compliance paths derive correctly on Windows. Rewrite `sanitizePersistedPath` to avoid relying on `process.cwd()` for relative inputs. Drops the Windows CI failure count from 15 → 11 test files ([#41](https://github.com/Eliyce/paqad-ai/issues/41)).

## 1.0.7

### Patch Changes

- [#55](https://github.com/Eliyce/paqad-ai/pull/55) [`d47cf96`](https://github.com/Eliyce/paqad-ai/commit/d47cf964d0c661c8369e7f69c374df02ef84a8c9) Thanks [@HLasani](https://github.com/HLasani)! - Cross-platform output consistency: normalize path strings to forward slashes at more production output boundaries — DocumentationWorkflow generated/skipped arrays and handover_path, onboarding orchestrator manifest writes and return values, `saveObligationIndex` return, registry-generator source_paths (both native-module and signal-extracted), and the project-question phase write target. Fix `slugifySpec` to split on both `/` and `\\` so spec-indexed compliance paths derive correctly on Windows. Rewrite `sanitizePersistedPath` to avoid relying on `process.cwd()` for relative inputs. Drops the Windows CI failure count from 15 → 11 test files ([#41](https://github.com/Eliyce/paqad-ai/issues/41)).

## 1.0.6

### Patch Changes

- [#38](https://github.com/Eliyce/paqad-ai/pull/38) [`c7aac12`](https://github.com/Eliyce/paqad-ai/commit/c7aac120bc503cf5122a8205c28c54506c96730f) Thanks [@HLasani](https://github.com/HLasani)! - Internal code-quality cleanup: remove 13 dead-store assignments flagged by `@eslint/js` v10's `no-useless-assignment` rule, and attach the original error as `cause` when wrapping decision-pause write failures so callers can inspect the underlying I/O error via `error.cause`.

- [#39](https://github.com/Eliyce/paqad-ai/pull/39) [`26bde79`](https://github.com/Eliyce/paqad-ai/commit/26bde79c651b7809de65469a5ac8fb23c9e20675) Thanks [@HLasani](https://github.com/HLasani)! - Upgrade TypeScript from 5.9.x to 6.0.x. Adds `ignoreDeprecations: "6.0"` to `tsconfig.json` to silence the `baseUrl`-deprecation warning emitted by `tsup`'s internal dts build pipeline (TS 7.0 will remove `baseUrl` entirely; tsup needs to drop its internal use before then).

## 1.0.5

### Patch Changes

- [#35](https://github.com/Eliyce/paqad-ai/pull/35) [`c8f7f03`](https://github.com/Eliyce/paqad-ai/commit/c8f7f03c60f4149579b4f3fb1c3c89be21c77811) Thanks [@HLasani](https://github.com/HLasani)! - Normalize generated path strings to forward slashes at more production output boundaries for cross-platform consistency ([#30](https://github.com/Eliyce/paqad-ai/issues/30), [#33](https://github.com/Eliyce/paqad-ai/issues/33)). Retry `runScript` once on transient bash-subprocess failures ([#25](https://github.com/Eliyce/paqad-ai/issues/25)). Skip Windows-incompatible tests in CI excludes and align timeouts ([#28](https://github.com/Eliyce/paqad-ai/issues/28)).

## 1.0.4

### Patch Changes

- [#21](https://github.com/Eliyce/paqad-ai/pull/21) [`8bc2642`](https://github.com/Eliyce/paqad-ai/commit/8bc2642c3af5f0af5dfc569507544c092b891503) Thanks [@HLasani](https://github.com/HLasani)! - Read `VERSION` constant dynamically from `package.json` at module load instead of hardcoding it. Future releases no longer need a manual `src/index.ts` edit to keep the exported constant in sync with the published version. Closes [#18](https://github.com/Eliyce/paqad-ai/issues/18).

## 1.0.3

### Patch Changes

- [#15](https://github.com/Eliyce/paqad-ai/pull/15) [`99b1e5b`](https://github.com/Eliyce/paqad-ai/commit/99b1e5b18f42634006f88e16c7eb2fc7091d3f43) Thanks [@HLasani](https://github.com/HLasani)! - First automated release via Changesets + GitHub Actions. No runtime change — this release exists only to validate the new publish pipeline (CI gating, version PR, npm provenance).

All notable changes to this project will be documented in this file. See [Changesets](https://github.com/changesets/changesets) for commit guidelines.
