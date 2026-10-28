---
id: "TD-01M61HS3CPS1RWVF61QYS7NSW9"
title: "Regenerate .paqad/.config.example so it lists spec_grounding_budget_ms (FR-39)"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - ".paqad/.config.example"
found_in:
  change: "01M61D0BG2CCC55M69SGH4AS8H"
  issue: "746"
  stage: null
found_by: "paqad-review"
session: "73714436-ef71-484e-922e-dbbe5b927dab"
created_at: "2026-10-28T15:24:08.965Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

FR-39 requires `spec_grounding_budget_ms` to appear in `.paqad/.config.example`. The key is declared in `FRAMEWORK_CONFIG_SPECS` (src/core/framework-config.ts) and the generator will emit it, but this repo's own committed `.paqad/.config.example` was not regenerated because the owner has uncommitted edits to that file. Regenerate it (config reconcile / onboarding update) once the owner's edits land, and commit the result.
