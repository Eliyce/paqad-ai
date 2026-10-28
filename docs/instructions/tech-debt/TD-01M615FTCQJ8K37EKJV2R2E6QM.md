---
id: "TD-01M615FTCQJ8K37EKJV2R2E6QM"
title: "Question round omits pending packets with no change, though they still block edits"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/spec-pipeline/round.ts"
found_in:
  change: "01M5JM36RM43G0JX8GD2PA7YTW"
  issue: "749"
  stage: null
found_by: "review"
session: "19ea5549-a6a6-420f-9c38-b10d9858ab78"
created_at: "2026-10-28T11:49:21.928Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`buildQuestionRound` (src/spec-pipeline/round.ts:66) lists only pending packets whose `change` equals this change. A legacy or hand-made packet with no `change` still blocks every edit through the decision-pause gate (INV-1), but it never shows up in the round. The round can then report zero packets while the gate blocks the edit. Possible fix: list no-change pending packets in the round too, in a separate "project-wide" group.
