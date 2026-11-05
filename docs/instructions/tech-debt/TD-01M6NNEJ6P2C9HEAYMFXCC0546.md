---
id: "TD-01M6NNEJ6P2C9HEAYMFXCC0546"
title: "A folder link in a change crashes the rule runner on edits"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/rule-scripts/runner.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "checks"
found_by: "orchestrator"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T10:53:06.611Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

When a folder link is among a change's files, the rule runner reads it as a file and throws EISDIR, so edits fail with a crash message instead of a rule message. See `src/rule-scripts/runner.ts`. It predates the stage recipes change.

Expected: the runner skips or follows a folder link and judges the edit normally.
