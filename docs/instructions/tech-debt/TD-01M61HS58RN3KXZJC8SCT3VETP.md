---
id: "TD-01M61HS58RN3KXZJC8SCT3VETP"
title: "Write the SubagentStart/Stop-on-resume observation into the one-development-agent issue (FR-57)"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "src/stage-isolation/subagent-completion.ts"
found_in:
  change: "01M61D0BG2CCC55M69SGH4AS8H"
  issue: "746"
  stage: null
found_by: "paqad-review"
session: "73714436-ef71-484e-922e-dbbe5b927dab"
created_at: "2026-10-28T15:24:10.887Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

FR-57: check on current Claude Code and Codex whether SubagentStart and SubagentStop fire again on a `SendMessage` / `send_input` resume, and write the observed answer into the one-development-agent issue as the issue asks. The code handles both outcomes (AC-34), but the observation is not yet recorded on the issue.
