---
id: "TD-01M5ZM74HQ27Q37PMD5SDAP6MJ"
title: "ac-test-mapping marks a criterion failing when a failing test from another spec names the same AC id"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/traceability/change-map.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "checks"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:28:17.192Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What happens

The ac-test-mapping gate marks an acceptance criterion of the active change as failing when any failing test, from any spec, has a title that names the same id. `collectFailingAcIds` in `src/traceability/change-map.ts` matches `issue.test_id` and `issue.suite` against every automated id of the active spec, with no link to the spec the test was written for.

## Seen on this change

`tests/e2e/managed-route-contract.e2e.test.ts` carries a test titled "AC-12: a rule-script deny still blocks on the managed route ...". That AC-12 belongs to an older spec. When it failed, the gate reported this change's AC-12 (the `report speed` error-line criterion) as having no proving test, even though `tests/unit/cli/report-speed.test.ts` proves it and is changed on this branch.

## Why it matters

AC ids restart at AC-1 in every spec, so a collision is likely in any repo with several frozen specs. One unrelated red test can hide the proof of a criterion in the current change, and the message points the developer at the wrong file.

## Possible fix

Count a failing test against an id only when the test file is changed on this branch, or is one of the files that already proves that id (`proofsByAc`). A failing test elsewhere stays a checks failure and does not unprove a criterion.
