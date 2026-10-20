---
id: "TD-01M5CW8D61K3PJVG7NW6Y2YQ52"
title: "Stop gate judges a change while High Table expert subagents still run in the background"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/verification-completion.mjs"
  - "src/stage-evidence/completion-deferred.ts"
found_in:
  change: "01M5CCWX6FTKY8C6EJKMR9EH3D"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "d789e5c2-ce91-442b-a379-7e12b94b7dd9"
created_at: "2026-10-20T14:43:13.216Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The Stop gate can judge a feature-development change while High Table expert subagents
(`paqad-expert`, `paqad-chief-architect`) are still running in the background. The orchestrator
saw the completion verdict land mid-seating on this change.

`deferCompletionForBackgroundStage` (src/stage-evidence/completion-deferred.ts:33-90) counts any
background task whose agent type starts with `paqad-`, so the prefix itself would match the
expert agents. The deferral is therefore lost somewhere else: either the `background_tasks`
entries for those agents carry no agent type field the helper reads (it then falls back to
"an unended stage is open", which is false once the specification stage agent has returned),
or the turn ends between dispatches with no task listed.

Expected: no verdict while any paqad subagent of the change is still running, including High
Table seats and the chief architect. Reproduce with a payload fixture captured from a real
seating turn and assert a `completion-deferred` row.
