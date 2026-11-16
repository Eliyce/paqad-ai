---
id: "TD-01M7JWD9QC3WNW70BE44FKHPV2"
title: "Parity test for FINISH_SCREEN_MS and STALL_MS across src/review-runs and the HUD mod"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/journey-model.ts"
  - "src/review-runs/view.ts"
found_in:
  change: "01M7JNJYXQNY74YJVH6NMP87YT"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "9a74b014-394a-5cac-921d-295ff6245bd4"
created_at: "2026-11-16T19:12:43.671Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The 30-minute finish window and the 20-minute stall threshold are defined twice: `FINISH_SCREEN_MS` / `STALL_MS` in `src/review-runs/view.ts` and again in `runtime/claude-plugin/mod/journey-model.ts`. The mod is a separately bundled runtime that imports nothing from `src/`, so one shared import is not possible, but nothing stops the two from drifting. Boundaries also differ by design (reviews `<` 30:00 exclusive in both runtimes; mod onboarding `<=` inclusive, pre-existing). Add one parity test that imports both modules and asserts the constants are equal, and that the review boundary is exclusive in both.
