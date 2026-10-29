---
id: "TD-01M648Z6SK96WQDAS4Q40KFVF2"
title: "High Table strip section cannot open the Ledger: Desktop refuses an Svg inside a Button"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "docs/instructions/design-system/hud.md"
  - "runtime/claude-plugin/mod/desktop-band.tsx"
found_in:
  change: "01M645V4RH7QQ7DZ5EK9AD0SKJ"
  issue: "776"
  stage: null
found_by: "development"
session: "4452c3b8-4135-4ed3-a93c-955a3aafff26"
created_at: "2026-10-29T16:47:55.162Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The spec wanted the High Table section of the Desktop strip to open the Ledger on High Table when pressed (FR-14 to FR-18, AC-16, AC-17, AC-19, AC-22, AC-24). The Claude Code engine refuses an `Svg` inside a `Button` ("holds strings and Text, not <Svg>") and skips the whole band draw, and only `Button` takes `onPress`. Decision D-01M647V8MDB5F683NZKHG8MVYM chose to ship with no press. The Ledger Button is still the way in.

Follow-up: if the engine later lets a Button hold an Svg, or lets a Box take a press, wire `openPane($, 'table')` to the High Table section (a `table` member on `BandActions`, key `paqad-table`) and update R16 in hud.md.
