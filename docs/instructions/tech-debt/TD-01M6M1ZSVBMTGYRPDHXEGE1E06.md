---
id: "TD-01M6M1ZSVBMTGYRPDHXEGE1E06"
title: "Remove the code that lets changes started before stage recipes close without recipe proof, after 4 December 2026"
kind: "debt"
severity: "medium"
status: "open"
files: []
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "specification"
found_by: "orchestrator"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-04T19:53:45.554Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The stage recipes change keeps a temporary path so changes already part way through at release can still close: stages run before the update get a warning line instead of needing the new proof.

The owner wants this removed. Remove it after 4 December 2026, one month after the decision on 4 November 2026.

Remove the old-era branch and its tests, then confirm the stage-enforcement contract test still passes on all routes.
