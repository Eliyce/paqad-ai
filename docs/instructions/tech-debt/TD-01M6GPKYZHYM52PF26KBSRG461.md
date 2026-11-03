---
id: "TD-01M6GPKYZHYM52PF26KBSRG461"
title: "collapseSameRole drops a seat's distinct findings that share a target"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/spec-pipeline/experts/merge.ts"
found_in:
  change: "01M6GKEB1CZ8YW9W66PBCP0C3N"
  issue: "830"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "b1c3f96d-5650-4ce0-87b3-8525f5b7de65"
created_at: "2026-11-03T12:37:19.962Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

collapseSameRole in src/spec-pipeline/experts/merge.ts:64-90 keeps only one finding per role inside a target group (the one with the longest claim), so when one expert seat reports two different findings on the same target, the other findings' claims are dropped (only their ids survive in merged_from). Fix: collapse only findings whose normalized claims match, and keep distinct claims from the same seat as separate findings. Found during the #830 review; not touched by #830.
