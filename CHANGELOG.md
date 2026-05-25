# paqad-ai

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
