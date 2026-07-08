---
'paqad-ai': minor
---

Build the deterministic check runner and stop assuming tests passed (#318). The
`checks` stage is meant to be 100% deterministic — run format/test/build and block
on red — but nothing executed the commands: the resolver had no caller and the
completion backstop hardcoded `code_tests_lint_passed: true`, so a change with
failing tests could still be reported green by the framework layer.

New `paqad-ai checks run` verb resolves the project's mapped commands, executes
them, and persists one `StructuredTestResult` per command (the shape the
`code-tests-lint` gate already consumes) to `.paqad/checks/last-run.json`; it exits
non-zero on any red. The completion backstop now reads that report: it populates
`structured_test_results`, derives `code_tests_lint_passed` from real execution (no
longer a hardcoded `true`), and replaces the `code-tests-lint` gate's skipped
placeholder with the report-driven verdict — a red report blocks the completion
verdict, a green one passes, and an absent report reads as Inconclusive rather than
a vacuous green. Deterministic throughout: a command's exit code is the verdict.
