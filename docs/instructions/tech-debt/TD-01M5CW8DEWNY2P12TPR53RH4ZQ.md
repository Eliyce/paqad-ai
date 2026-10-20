---
id: "TD-01M5CW8DEWNY2P12TPR53RH4ZQ"
title: "Implementation-review gate demands citations for duplication rows outside the change diff"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/review-digest/sources.ts"
  - "src/verification/gates/implementation-review.ts"
found_in:
  change: "01M5CCWX6FTKY8C6EJKMR9EH3D"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "d789e5c2-ce91-442b-a379-7e12b94b7dd9"
created_at: "2026-10-20T14:43:13.495Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The implementation-review gate and the review digest require the review to cite deterministic
duplication rows in files the change never touched. On this branch 15 of the 16 deterministic
duplication rows (src/context/index.ts, src/discovery/index.ts, src/evidence/index.ts,
src/feature-evidence/index.ts, src/rag/index.ts, src/rule-scripts/index.ts and nine test files)
are not in `git diff origin/main...HEAD`; the sixteenth (tests/unit/delivery/ci-gate.test.ts:5-16)
points at pre-existing lines.

`collectMachineFindings` / `duplicationRows` (src/review-digest/sources.ts:52) read the cached
`.paqad/scripts/rules/.cache/duplication.json` as-is, with no filter against the change's diff
and no check that the cache was computed against the current base. A stale cache from before
main moved reports main's own files as "new code".

Expected: only rows whose file and line range intersect the change's added lines are
deterministic-and-citable; others are dropped or shown as context. Stale caches (base sha
differs) are recomputed or marked stale.
