# Deterministic Check Runner

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Slug:** `verification/check-runner` &nbsp;·&nbsp; **Issue:** #318

## Purpose

The `checks` stage is the one the product thesis says must be **100% deterministic**:
run the project's format / test / build commands and block on red. Before this, the
command resolver existed but had no caller, and the agent-independent completion
backstop hardcoded `code_tests_lint_passed: true` — so a change with failing tests
could still be reported green by the framework layer. The check runner closes that:
it executes the mapped commands and turns each exit code into a `StructuredTestResult`,
the exact shape the `code-tests-lint` gate already consumes. No LLM, no heuristic — a
command's exit code is the verdict.

## How it runs (per host)

The agent invokes `npx paqad-ai checks run` mid-turn, the same proven pattern as
`paqad-ai stage`. It is never typed by a human. On **Claude Code** a red report also
blocks the completion verdict (the only PreToolUse/Stop-capable host); on
**Codex/Gemini** the report is recorded and read at completion; on advisory hosts the
verb still runs when the model calls it, but nothing blocks.

## Flow

1. `runChecks()` (`src/checks/run-checks.ts`) resolves the `checks` stage commands via
   `resolveFeatureDevelopmentCheckCommands` (project profile → `format` / `test` /
   `build`), runs each through the shared delivery shell, and builds one
   `StructuredTestResult` per command. `evidence_scope.related_paths` is set to the
   change's files so `assessTestEvidence` maps the run to the affected code.
2. `paqad-ai checks run` (`src/cli/commands/checks.ts`) persists the results via
   `writeChecksReport` to `.paqad/checks/last-run.json`, prints the `▸ paqad` verdict,
   and exits non-zero on any red command.
3. The completion backstop (`buildRepositoryVerificationContext`) reads the report,
   populates `structured_test_results`, and derives `code_tests_lint_passed` from it —
   no longer a hardcoded `true`.
4. `runRepositoryVerification` replaces the `code-tests-lint` gate's `skipped`
   placeholder with the report-driven verdict: red → `fail` (verdict blocks), green →
   `pass`, no report → left `skipped` so the run reads Inconclusive via the escalation.

## Inconclusive, never a false pass

When no command is mapped, or `paqad-ai checks run` was not run this change, there is
no report: `structured_test_results` stays undefined, the gate stays `skipped`, and the
context escalates "test-evidence Inconclusive". The framework never reports green on
unrun or failing tests.

## Source Footprint

- `src/checks/run-checks.ts` — resolve + execute + structure.
- `src/checks/report-store.ts` — atomic persist / tolerant read of the report.
- `src/cli/commands/checks.ts` — the `paqad-ai checks run` verb.
- `src/verification/repository/repository-context.ts` — consumes the report.
- `src/verification/repository/run-repository-verification.ts` — `checksEvidenceGate`.

## Authority

The single source of truth for this module's identity, slug, feature names, and source
paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml)
(feature slug `check-runner` under the `verification` module). If anything here
disagrees with the map, the **map wins**.
