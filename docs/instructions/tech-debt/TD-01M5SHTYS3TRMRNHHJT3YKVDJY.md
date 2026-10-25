---
id: "TD-01M5SHTYS3TRMRNHHJT3YKVDJY"
title: "Concurrent background-agent permission asks: settling the later one clears the band while the earlier one still waits"
kind: "bug"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/live.ts"
found_in:
  change: "01M5S7SJN1JPHCMVJC8CCJX8WM"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "d4f011b8-0e28-4853-b240-4efec92ea6c5"
created_at: "2026-10-25T12:51:14.325Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

runtime/claude-plugin/mod/live.ts tracks one waiting permission (waitingOn, waitingToolUseId, waitingAgent). When two background agents ask for permission at once, the second ask overwrites the first; when the second agent's ask settles (its next tool, next permission check or turn end), the band drops Waiting for your permission while the first agent is still waiting on the user. The main-thread ask is protected; only concurrent background asks are affected. Follow-up: keep a small set of waiting asks keyed by agent id and clear each one on its own settle.
