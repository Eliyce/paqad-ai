---
id: "TD-01M6PVPSGTY2WWVFZGY1FRE3HE"
title: "Two engine installs starting together can both run"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/core/optional-package.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: null
found_by: "orchestrator"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:01:42.139Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

From the expert review of this change, read from the code and not reproduced. The install checks for the lock and then writes it in a separate step, so two processes starting at the same moment can both start an install into the same folder.
