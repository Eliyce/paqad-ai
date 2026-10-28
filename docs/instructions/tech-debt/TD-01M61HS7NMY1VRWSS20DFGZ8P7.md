---
id: "TD-01M61HS7NMY1VRWSS20DFGZ8P7"
title: "Correct the plugin-directory issue text that still says ^@ (FR-12)"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "src/rule-scripts/rule-id.ts"
found_in:
  change: "01M61D0BG2CCC55M69SGH4AS8H"
  issue: "746"
  stage: null
found_by: "paqad-review"
session: "73714436-ef71-484e-922e-dbbe5b927dab"
created_at: "2026-10-28T15:24:13.347Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

FR-12 asks that the plugin-directory issue text be corrected so the next reader does not repeat the `\^@` / `\^A` mistake (TypeScript reads those as the literal characters). The issue still says `\^@`. Edit the GitHub issue to name `\x00` / `\x01` (and note that `\x01`..`\x1f` escapes were further rewritten as `String.fromCharCode` because the bundler prints them back as raw bytes).
