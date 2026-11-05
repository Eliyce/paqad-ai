---
id: "TD-01M6PXQZQTKBNSE88RRKF8NTRC"
title: "live-run-replay test uses most of its timeout and fails under load"
kind: "gap"
severity: "low"
status: "open"
files:
  - "tests/unit/hud/live-run-replay.test.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:37:18.376Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The first test in tests/unit/hud/live-run-replay.test.ts takes about 6.4 seconds alone on a laptop against the 10 second `testTimeout` in vitest.config.ts. Eight copies run at once gave 9.66 to 9.88 seconds for seven and 10.06 seconds, a timeout, for one. A code fault is not needed to turn it red: load is enough.

## Why it matters

A slow CI runner or a busy full-suite run can fail it with no code fault, which teaches people to rerun red runs. The one failure reported during this change was not captured, so a timeout is the likely cause and not a proven one.

## Fix

Give this test its own longer timeout, or shorten the replay fixture. Find why one replay costs six seconds first: the test may be repeating expensive work for each step.
