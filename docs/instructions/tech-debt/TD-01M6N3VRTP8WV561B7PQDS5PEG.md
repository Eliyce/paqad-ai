---
id: "TD-01M6N3VRTP8WV561B7PQDS5PEG"
title: "agent status says every stage passed when some were skipped, overridden or carried from an earlier release"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/authoring/stages/status.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T05:45:45.019Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`paqad-ai agent status` (and `skill status`) ends with "Every stage has passed." whenever every stage reads as gate-satisfied (`src/authoring/stages/status.ts:112`). `gateSatisfied` counts skipped and overridden stages, and a stage that passed on an earlier release, so the line overstates what was proven. Reword it to name overrides, skips and stages carried from an earlier release. Found while reviewing the stage recipes change; that change does not touch this file.
