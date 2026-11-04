---
id: "TD-01M6KHDHEFXCHZBK416J6BTHNC"
title: "Hook advice says tracked for a husky folder that may not be tracked"
kind: "bug"
severity: "low"
status: "closed"
files:
  - "src/feature-evidence/git-hooks.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: null
found_by: "documentation_sync"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T15:04:09.909Z"
reopened_at: null
issue: null
closed_reason: "The advice and join now say husky runs the hooks when the husky runner folder is in use, and plain tracked folders keep the original sentence."
---

## What

## What

`trackedWorkflowHookAdvice` and the delivery hook snippet in `src/feature-evidence/git-hooks.ts` say "which your repo tracks" and "your tracked hooks dir". They now also run for an untracked `.husky/_`, where those words can be wrong.

## Fix idea

Word both lines so they hold for a husky folder git doesn't track.
