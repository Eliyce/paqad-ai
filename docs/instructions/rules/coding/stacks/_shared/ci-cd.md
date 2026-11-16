# CI/CD

Loads for code changes.

<!-- trigger: ** -->

- Run the same format, lint, test, and build gates in CI that block local delivery, so a green local run predicts a green CI run. <!-- @rule RL-469b -->
- Keep the pipeline green. MUST NOT merge on red. <!-- @rule RL-6c73 -->
- Commit the lockfile and pin tool versions so CI and local environments resolve the same dependencies. <!-- @rule RL-3d8c -->
- Fail the build on a high- or critical-severity dependency advisory. <!-- @rule RL-c29f -->
- graph-ui must resolve vite to 6.4.6 or later (never 6.4.5 or below) in graph-ui/pnpm-lock.yaml. <!-- @rule RL-6c4f discovered:rd-20261116-061901 -->
- graph-ui TypeScript must be type-checked with `tsc --noEmit -p graph-ui` (in its build script or in CI) because `vite build` only transpiles. <!-- @rule RL-2a0d discovered:rd-20261116-061901 -->
