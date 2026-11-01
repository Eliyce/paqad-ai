---
id: "TD-01M6BTETM9JGZS1JJM63TDNPWE"
title: "Review digest line cap truncates deterministic high-severity rows behind info heuristics"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/review-digest/digest.ts"
found_in:
  change: "01M6B5R44JDNFBPXYAESEE5SN5"
  issue: "795"
  stage: "checks"
found_by: "paqad-review"
session: "4af9b4d2-9c6e-5ad7-9964-e1f971c5186b"
created_at: "2026-11-01T15:08:13.661Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The review digest caps the whole markdown at 150 lines (DIGEST_LINE_CAP) and truncates the tail. Machine findings are ordered rule rows first, then duplication, checks and gate rows, so on a large change the deterministic high rows (checks failing, gate failures) are the ones cut off and never shown to the reviewer. On change 795 the digest hid 31 rows including `checks: build 1 failing`, `vitest: 5 failing` and the `gate:*` high rows. Fix: sort findings by tier/severity before capping, or cap info/heuristic rows first and always keep deterministic high rows.
