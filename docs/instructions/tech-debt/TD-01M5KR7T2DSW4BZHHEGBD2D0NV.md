---
id: "TD-01M5KR7T2DSW4BZHHEGBD2D0NV"
title: "Turn-end completion gate grades a change while a plugin-namespaced paqad stage agent still runs in the background"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/verification-completion.mjs"
  - "src/stage-evidence/completion-deferred.ts"
found_in:
  change: "01M5JN71AWEY8H27VTZ1ZBS1EY"
  issue: null
  stage: null
found_by: "paqad-review"
session: "36466929-a6e4-456b-8ffe-d045c79ed49e"
created_at: "2026-10-23T06:47:40.354Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The turn-end completion gate graded change 01M5JN71AWEY8H27VTZ1ZBS1EY (wrote receipt.json and
verification-evidence.json at 2026-10-23T06:40-06:41Z) while the `paqad-development` stage agent
was still running in the background. It should have deferred.

Likely cause: `stageAgentTaskCount` (src/stage-evidence/completion-deferred.ts:34) counts only
tasks whose agent type starts with `paqad-`. When paqad runs as a Claude Code plugin, its agents
are namespaced: stage-evidence rows for this change carry `"agent":"paqad:paqad-development"`.
`paqad:paqad-development` does not start with `paqad-`, and because the task does carry an agent
type, the `!tasksCarryAgentType(tasks)` fallback is skipped too, so no `completion-deferred` row
is written and the verdict lands mid-stage.

Related to TD-01M5CW8D61K3PJVG7NW6Y2YQ52 (High Table seats), which may share this cause.

Expected: no verdict while any paqad stage agent of the change is running, whether its type is
`paqad-<x>` or the plugin-namespaced `paqad:paqad-<x>`. Fix: strip a `paqad:` namespace before the
prefix test (or match `/^paqad[:-]/`) and add a payload fixture with a namespaced agent type that
asserts a `completion-deferred` row.
