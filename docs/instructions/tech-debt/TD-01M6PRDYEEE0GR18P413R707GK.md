---
id: "TD-01M6PRDYEEE0GR18P413R707GK"
title: "The duplication report calls older main code new, and that code holds real repeats"
kind: "debt"
severity: "low"
status: "open"
files:
  - "src/review-digest/sources.ts"
  - "tests/unit/cli/join.test.ts"
  - "tests/unit/update/updater.test.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T21:04:26.543Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The duplication report names docs/modules/cli-lifecycle/index/summary.md:90-107, docs/modules/skill-runtime/index/summary.md:95-112, tests/unit/feature-evidence/stage-ledger.test.ts:33-40, tests/unit/update/updater.test.ts:45-62 and tests/fixtures/hooks/claude/subagent-start.json:1-9 as new code. All five last changed in 60d947fb, an ancestor of this branch's merge base, so they are not new in this change. Some duplication is real on main: updater.test.ts:45-62 is identical to tests/unit/cli/join.test.ts:98-115, and the two summary sections repeat module boilerplate. The report also reads as if it belongs to this change when it does not. Share the helper, and make the report scope itself to the current diff.
