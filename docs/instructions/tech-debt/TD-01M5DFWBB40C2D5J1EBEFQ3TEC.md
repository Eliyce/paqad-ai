---
id: "TD-01M5DFWBB40C2D5J1EBEFQ3TEC"
title: "Capability-gate pre-mutation hook times out on a cold run (about 10.4s vs its 10s timeout), blocking the first edit after a tree change"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/capability-gate.mjs"
  - "src/adapters/shared/paqad-hooks.ts"
found_in:
  change: "01M5DC6C8R1KBH145FZ8HS1VTC"
  issue: "625"
  stage: "review"
found_by: "paqad-review"
session: "36416bc0-b415-43e8-943d-22b4b74f241f"
created_at: "2026-10-20T20:26:09.628Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The capability-gate pre-mutation hook (runtime/hooks/capability-gate.mjs, registered fail-closed with a 10 second timeout in src/adapters/shared/paqad-hooks.ts) takes about 10.4 seconds on a cold run after a tree change. Claude Code kills it at the 10 second timeout, and because the gate is fail-closed the first Edit or Write after the tree change is blocked with "timed out". A retry passes because the second run is warm.

Seen during the stage-helper seeding change; that change does not touch the gate and must not (gate hooks stay byte-identical).

Options to weigh: make the cold path faster (cache or lazy-load what the cold run builds), warm it at SessionStart, or raise the timeout with care since it is fail-closed. Raising the timeout alone hides the cost on every cold edit.
