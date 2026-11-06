---
id: "TD-01M6RQ1TZDWKKG5ZF9F3ZXY7PX"
title: "A pipeline-made spec can't be corrected after freeze without a manual re-freeze that marks it hand-written"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/cli/commands/spec.ts"
  - "src/spec-pipeline/run-store.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "specification"
found_by: "paqad-specification"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T15:18:50.057Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A spec made by the pipeline cannot be corrected after its freeze without a manual re-freeze that marks it hand-written.

The first freeze clears the pipeline's staging folder (`clearFrozenRun`), so `spec freeze --from-pipeline` then refuses with `run paqad-ai spec pipeline finish first`, and `spec pipeline status` reports `next_step: ground`. A re-freeze also needs the spec's hash to match a staged craft, so an amended spec can't pass it without a full new pipeline run.

The only other route is `--manual --reason`. It records `pipeline.produced=false`, and the new `specification.json` loses the task, grounding, trace and pipeline sections, even though the spec came from the pipeline. The bundle's `experts.json` and `high-table.jsonl` stay, but the frozen record no longer links to them.

Seen on the one-click earlier answers change, where the owner approved an amendment after review and chose the manual re-freeze (D-01M6RPVGZWGTJG0XAW5KYZBDMS).

Possible fix: give `spec freeze` a way to amend a frozen spec that keeps its pipeline record and records the amendment and who approved it.
