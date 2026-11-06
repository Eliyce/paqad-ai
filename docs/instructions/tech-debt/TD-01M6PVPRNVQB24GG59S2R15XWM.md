---
id: "TD-01M6PVPRNVQB24GG59S2R15XWM"
title: "A dead engine install leaves its lock behind and blocks later installs"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/core/optional-package.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: null
found_by: "orchestrator"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:01:41.275Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

From the expert review of this change, read from the code and not reproduced. The engine install writes its lock and "installing" marker before it starts, and only the install script clears them. If that process dies midway, later calls keep answering in-progress and the engine never installs.
