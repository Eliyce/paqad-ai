---
id: "TD-01M5SHTX96QGWZECDMF2926BA4"
title: "Stop hooks skip the deferral check when background_tasks is empty, so a checks-run marker alone never defers"
kind: "gap"
severity: "low"
status: "open"
files:
  - "runtime/hooks/verification-completion.mjs"
  - "src/stage-evidence/completion-deferred.ts"
found_in:
  change: "01M5S7SJN1JPHCMVJC8CCJX8WM"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "d4f011b8-0e28-4853-b240-4efec92ea6c5"
created_at: "2026-10-25T12:51:12.794Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The Stop hooks (runtime/hooks/verification-completion.mjs and capability-gate.mjs, deferredForBackgroundStage) return early when the payload's background_tasks is empty, so deferCompletionForBackgroundStage never sees a live checks running marker unless some background task is listed. The unit test for "defers while this session holds a live checks run marker, with no background task" passes at the function level but that path is unreachable through the real hooks. The hooks are frozen for this change, so the limit stays. In practice a foreground checks run keeps the turn open and a background one is listed as a task, so the gap is narrow. Follow-up: decide whether the hooks should call the function on an empty list, under its own change with the contract suite in scope.
