---
id: "TD-01M6PTPA0NJBPK6Z62GFAF7B37"
title: "The AC-67 base comparison does not run in CI, so it can go red on main unseen"
kind: "gap"
severity: "medium"
status: "open"
files:
  - ".github/workflows/ci.yml"
  - "tests/unit/guardrails/stage-guardrail.test.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T21:43:57.682Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The base comparison in tests/unit/guardrails/stage-guardrail.test.ts needs `origin/main` (mergeBase at line 195) and skips when it is missing. The test job's checkout at .github/workflows/ci.yml:162 sets no fetch-depth, so from reading the workflow a pull request has no `origin/main` and the AC-67 comparison skips there. On a push to main the matrix was skipped by the scope job: run 42092520569 for b3039234 shows `test: skipped`. That is how the comparison could fail on a clean main at b3039234 while CI stayed green. It runs only on a developer's machine. Fetch main in the test job, or run these comparisons in the scope job, which has full history.
