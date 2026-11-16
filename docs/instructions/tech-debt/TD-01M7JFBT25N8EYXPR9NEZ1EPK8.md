---
id: "TD-01M7JFBT25N8EYXPR9NEZ1EPK8"
title: "A local plugin opt-out in one repo stops the background plugin install on every repo of the machine"
kind: "follow-up"
severity: "medium"
status: "open"
files:
  - "src/install/plugin-migration.ts"
found_in:
  change: "01M7J8JE08Q0TPKF57BS49FRWZ"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "c3d97a78-504b-5d70-81e8-966dd5dfda15"
created_at: "2026-11-16T15:24:43.345Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

migrationOptOut in src/install/plugin-migration.ts records a `.claude/settings.local.json` opt-out as state `declined`, as spec FR-2 asks. `declined` is settled (isSettled) and the record lives in the machine-wide ~/.paqad-ai/plugin-migration.json, and the team launcher treats it as settled too. So turning the plugin off in one repo's local settings stops the background install for every other repo on that machine. Decide whether a per-repo opt-out should be a per-repo skip (config skip) instead of a machine-wide decline.
