---
id: "TD-01M7JWDAK6FDY8RH19K57RW3M6"
title: "Review-run CLI edge contracts: commander errors under --json, stage start on stopped or done stage, now taken before lock"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "src/cli/commands/review-run.ts"
  - "src/review-runs/actions.ts"
  - "src/review-runs/store.ts"
found_in:
  change: "01M7JNJYXQNY74YJVH6NMP87YT"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "9a74b014-394a-5cac-921d-295ff6245bd4"
created_at: "2026-11-16T19:12:44.556Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Review-run CLI edge contracts left loose:
1. Commander usage errors (missing `<verb>` on `stage`, unknown option) print commander's own stderr text and leave stdout empty, so `--json` does not yield one JSON object (AC-5 covers module refusals only).
2. `stage <id> start` on a stopped run silently reopens it (status running, stopped cleared) without `resume`, and on a done stage resets it to running.
3. `commitReviewRun` takes `now` before waiting on the lock, so `updated_at` can be up to the lock wait (about 2 s) older than a write that landed earlier.
Decide whether each should refuse or stay permissive, and test the choice.
