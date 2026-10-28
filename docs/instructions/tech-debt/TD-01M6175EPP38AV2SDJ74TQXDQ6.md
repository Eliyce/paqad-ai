---
id: "TD-01M6175EPP38AV2SDJ74TQXDQ6"
title: "A new change reuses a stale change key, so another session's old delivery rows make the stage order fail"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/feature-evidence/adoption.ts"
  - "src/feature-evidence/stage-ledger.ts"
found_in:
  change: "01M5JM36RM43G0JX8GD2PA7YTW"
  issue: "749"
  stage: null
found_by: "orchestrator"
session: "19ea5549-a6a6-420f-9c38-b10d9858ab78"
created_at: "2026-10-28T12:18:39.430Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A new feature-development change took a change key that an older session had already used, so the bundle holds rows from both sessions.

Seen on the ask-owner-once change: change 01M5JM36RM43G0JX8GD2PA7YTW has 5 rows from session 72b15d9e on 2026-10-22 (development, then delivery start and end), followed by 53 rows from this session from 2026-10-28 (planning through documentation_sync). The completion gate reads that delivery row as earlier than every stage of today's run and reports "stages ran out of order: planning -> delivery, ...". This happens even though today's run went in order.

The key was already the session's active change when `lane set full` ran at the start, before planning, and `plan compile` kept it. The likely cause is the session's active-change pointer or branch adoption resolving to a stale in-flight change.

Fix idea: when planning starts a new change, mint a fresh change key unless the stale bundle belongs to the same session and has no delivery end. The stage-order check should also consider only rows from the session that owns the change.
