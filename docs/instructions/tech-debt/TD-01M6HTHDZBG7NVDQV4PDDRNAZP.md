---
id: "TD-01M6HTHDZBG7NVDQV4PDDRNAZP"
title: "The writeOldLeftovers test helper is copied in updater.test.ts and join.test.ts"
kind: "debt"
severity: "low"
status: "open"
files:
  - "tests/unit/cli/join.test.ts"
  - "tests/unit/update/updater.test.ts"
found_in:
  change: "01M6HHDVSS4MZFF3KZBTEPN2KV"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "0c5e7458-3c33-4900-93fc-d6c7624e21bc"
created_at: "2026-11-03T23:05:05.748Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

tests/unit/update/updater.test.ts:32-49 and tests/unit/cli/join.test.ts:98-115 hold the same 18-line writeOldLeftovers helper. Both copies came from one earlier commit on this branch, before this change started, and neither is on main yet. The detector is right to call them new against main.

## Fix

Move the helper to a shared test helper and import it in both files.
