---
id: "TD-01M66075TDSGVAN8817DTHCV2K"
title: "Completion gate tree identity 10 s limit can block large repos with a permanent unconfirmed verdict"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/verification/repository/repository-context.ts"
found_in:
  change: "01M65SFN9BMVXRVPPYN44SJEVQ"
  issue: "754"
  stage: "review"
found_by: "paqad-review"
session: "b56f5d5d-6913-44b6-a7b8-a4346eb0fd48"
created_at: "2026-10-30T08:53:27.994Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The completion gate computes the current tree identity with a 10-second limit (CHECKS_FRESHNESS_TIMEOUT_MS). On a large onboarded repository, a cold stat cache or many untracked non-ignored files can keep `git add -A` on the temp index past 10 s every time. The gate then reads "Checks could not confirm which files they ran on" again and again. Running checks again does not clear it, because `checks run` uses 60 s, records a tree, and the gate then times out again. This is a false Inconclusive (safe direction), but it can block completion with no way out.

## Fix

Use the checks-run limit (or a configurable one) at the gate. Or cache the gate's identity per index mtime, so a second gate pass is cheap.
