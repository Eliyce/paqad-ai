---
id: "TD-01M6RNC8SZ3TY4VZGVGVY38TJE"
title: "pnpm run ci tests before it builds, so script tests need an existing dist"
kind: "debt"
severity: "low"
status: "open"
files:
  - "package.json"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T14:49:34.748Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`package.json` `ci` runs `test:coverage` before `build`, and the decision skill script tests import `paqad-ai`, which resolves to `dist/index.js`. With no `dist`: `earlier-check-scripts.test.ts` fails 4 of 4 and the existing create and resolve contract tests fail 5 with ERR_MODULE_NOT_FOUND. With a stale `dist` those tests run against the last build. CI itself is fine: `ci.yml` builds at line 188 before the test shards at line 193.

Fix direction: move `pnpm run build` before `pnpm run test:coverage` in the `ci` script.
