---
id: "TD-01M6PRDXR9JDW5GXJ0PQHN5RE2"
title: "ac-test-mapping misses titles in it.runIf(cond)(title) and matches ids across specs"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/traceability/change-map.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T21:04:25.835Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`TEST_CALL` in src/traceability/change-map.ts reads a title from the first argument of `it.runIf(cond)(title)`, which is the condition, so a title in that form never maps. That is why ac-test-mapping fails on AC-27 although tests/unit/runtime/install-engine.test.ts:371-372 holds the test. Ids are also matched as plain text across specs, so AC-7 maps through older titles such as runtime/claude-plugin/mod/register.test.ts:679, not through tests/unit/plugin/gate-boundary.test.ts, which it does not read. A mapped id is not evidence the right test exists.
