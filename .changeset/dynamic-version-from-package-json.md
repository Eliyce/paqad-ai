---
'paqad-ai': patch
---

Read `VERSION` constant dynamically from `package.json` at module load instead of hardcoding it. Future releases no longer need a manual `src/index.ts` edit to keep the exported constant in sync with the published version. Closes [#18](https://github.com/Eliyce/paqad-ai/issues/18).
