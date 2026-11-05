---
id: "TD-01M6NGJMG849DTK949D3PBRWMC"
title: "Slow contract e2e tests can pass the 10 second limit in a combined run"
kind: "gap"
severity: "low"
status: "open"
files:
  - "tests/e2e/helpers/ensure-built.ts"
  - "tests/e2e/managed-route-contract.e2e.test.ts"
  - "vitest.config.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T09:27:57.163Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

Two e2e files that run several CLI and hook processes per test rely on the 10 second default test timeout in `vitest.config.ts`. In `tests/e2e/managed-route-contract.e2e.test.ts` the spec gate tests take about 3.5 seconds and the bundle write test about 2.9 seconds on an idle 12 core machine. With 36 busy processes running, three tests failed with `Test timed out in 10000ms`: the graduated lane test, the fast lane test and the bundle write test. All other tests passed, and no assertion failed.

A combined run with parallel workers can reach the same limit. Two contract tests failed once this way with no error kept, so this is the likely cause, though that one failure cannot be proven after the fact.

A second, smaller hazard: `recordPlanning` uses `reject: false`, so a failed CLI call shows up later as a confusing assertion. `ensureBuiltDist` also rebuilds with tsup `clean: true` when a source file gets newer than dist, which deletes dist under any test running at that moment.

## What a fix needs

Give the slow tests in `managed-route-contract.e2e.test.ts` their own 30 second timeout, as `stage-recipe-routes.e2e.test.ts` does with 60 seconds. Leave `stage-enforcement-contract.e2e.test.ts` alone, because AC-33 freezes it; if it needs more time, raise the limit through config for `tests/e2e/`. Keep the failure output of a combined run so a repeat can be read.
