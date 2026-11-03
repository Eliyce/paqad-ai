---
id: "TD-01M6G05FFW8AC9TDKMP55GB8PW"
title: "Duplicated approvals setup between dashboard server.test.ts:186-220 and approvals.test.ts:24-58"
kind: "debt"
severity: "low"
status: "open"
files:
  - "tests/unit/dashboard/approvals.test.ts"
  - "tests/unit/dashboard/server.test.ts"
found_in:
  change: "01M6EX814WG84WBN1YCW034G48"
  issue: "791"
  stage: "checks"
found_by: "paqad-review"
session: "6e440033-f345-4ab7-baee-663c65ece92f"
created_at: "2026-11-03T06:04:56.676Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The duplication detector flags tests/unit/dashboard/server.test.ts:186-220 as 99% similar to tests/unit/dashboard/approvals.test.ts:24-58. git blame shows 34 of the 35 lines come from f38179b8 and one from 9467f477. Both are ancestors of 6210b445, and this change edits server.test.ts only from line 607 onward. A shared approvals test fixture would remove the copy. The gate demanding a citation for a row outside the diff is TD-01M5CW8DEWNY2P12TPR53RH4ZQ.
