---
id: "TD-01M6NMGFR3E41XGDDQ2CQC5F1D"
title: "Rule scripts that read the working folder or skip links can misjudge an edit's result"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/rule-scripts/execute.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "checks"
found_by: "orchestrator"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T10:36:41.059Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The pre-edit rule check compares an edit's result on a temporary linked copy of the project. A rule script that reads `process.cwd()` or skips links can judge the wrong files there, so it may refuse an edit that only removes a finding. See `src/rule-scripts/execute.ts`.

Expected: the comparison runs every rule script against the same files the real check sees.
