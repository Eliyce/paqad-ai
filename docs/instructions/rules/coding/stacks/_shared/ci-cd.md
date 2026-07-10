# CI/CD

Loads for code changes.

<!-- trigger: ** -->

- Run the same format, lint, test, and build gates in CI that block local delivery, so a green local run predicts a green CI run.
- Keep the pipeline green. MUST NOT merge on red.
- Commit the lockfile and pin tool versions so CI and local environments resolve the same dependencies.
- Fail the build on a high- or critical-severity dependency advisory.
