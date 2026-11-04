---
id: "TD-01M6K2SR17Q2AW6C9D5FSVFQDH"
title: "The old leftovers test helper is copied in two test files"
kind: "debt"
severity: "low"
status: "open"
files:
  - "tests/unit/cli/join.test.ts"
  - "tests/unit/update/updater.test.ts"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: "review"
found_by: "review"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T10:48:41.229Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`writeOldLeftovers` is copied word for word in `tests/unit/update/updater.test.ts:40-57` and `tests/unit/cli/join.test.ts:98-115`. The copy was already on the branch before this change's commits, and this change didn't touch those lines.

## Fix idea

Move the helper into a shared test helper and import it from both files.
