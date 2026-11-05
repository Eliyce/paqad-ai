---
id: "TD-01M6M931VPCRP9EDCWKHW7T463"
title: "A frozen spec cannot be corrected without losing its pipeline record"
kind: "debt"
severity: "medium"
status: "open"
files:
  - "src/cli/commands/spec.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "development"
found_by: "paqad-development"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-04T21:57:52.089Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A one-value correction to a frozen spec had to use `spec freeze --manual`, because the first freeze cleared the pipeline run.
That dropped `task`, `grounding`, `trace` and the expert summary from `specification.json`.

It also marks the spec as hand-written, so the HUD hides the High Table and says it never sat, and the receipt says the spec was frozen without the pipeline. Both are false: the seats did sit, and `experts.json` and `high-table.jsonl` hold their work.

Expected: a correction to a frozen spec keeps them and does not read as hand-written, and the HUD shows the High Table whenever seats are on record.
