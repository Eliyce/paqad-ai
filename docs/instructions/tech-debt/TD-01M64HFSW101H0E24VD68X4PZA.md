---
id: "TD-01M64HFSW101H0E24VD68X4PZA"
title: "HUD isolation-missing flag counts pre-raise stage-agent rows; the gate counts only rows after lane_raised.at"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/hud/snapshot.ts"
  - "src/stage-isolation/isolation-summary.ts"
found_in:
  change: "01M64CVW05BZRGV1SHXT8WN7J7"
  issue: "750"
  stage: null
found_by: "paqad-review"
session: "0bbd9c56-f2a9-4da8-94d7-a58d08d85b00"
created_at: "2026-10-29T19:16:47.599Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

After a forward-only raise, the completeness gate counts only stage-agent rows recorded at or after `lane_raised.at` (`hasStageAgentEvidenceSince`, src/verification/repository/bundle-completeness-gate.ts:221-228). The HUD `isolation-missing` flag (src/hud/snapshot.ts:1284-1290) still counts every stage-agent row via `summarizeStageIsolation` / `stageAgentsSeen`. A classifier-full change normally runs planning in a stage helper before the plan lowers the lane, so after a raise the gate can FAIL while the HUD shows no isolation-missing flag. Both read the same `stageIsolationStatus`, but they count different evidence. The spec lists "Any HUD code change" as a non-goal, so this change does not fix it.
Fix: pass `stageIsolationSince` (or the `lane_raised.at`) into the HUD isolation count, e.g. a `summarizeStageIsolation(root, dir, { since })` variant used only for the flag, so the flag uses the same row filter as the gate.
