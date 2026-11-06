---
id: "TD-01M6PVPT876Z739C9DTJGBT6PT"
title: "A timed-out Allow once can record an override the HUD reports as failed"
kind: "gap"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: null
found_by: "orchestrator"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:01:42.888Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

From the expert review of this change, read from the code and not reproduced. If `rules override` is still running when the 15 second limit ends, the HUD reports a failure and the edit stays blocked, but the override line may already have been written, so the evidence and the screen can disagree.
