---
id: "TD-01M5D0M3XDBWAMK4H8DV6AJ543"
title: "Commits after a bundle closes open a stray fast-lane bundle"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/feature-evidence/stage-ledger.ts"
found_in:
  change: "01M5CCWX6FTKY8C6EJKMR9EH3D"
  issue: null
  stage: null
found_by: "orchestrator"
session: "d789e5c2-ce91-442b-a379-7e12b94b7dd9"
created_at: "2026-10-20T15:59:31.239Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Two fix commits made after a feature bundle had closed opened a new fast-lane bundle instead of continuing the change they belong to. The review agent had to run `paqad-ai resume --feature <id>` by hand to reattach the work, and the stray bundle stays behind with no owner. A late fix on a delivered change should either reopen that change or ask which change it belongs to.
