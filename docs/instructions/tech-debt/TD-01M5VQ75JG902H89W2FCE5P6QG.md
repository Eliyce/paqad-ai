---
id: "TD-01M5VQ75JG902H89W2FCE5P6QG"
title: "The cost total leaves out High Table seat tokens that only the host reported"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/cost/change-cost.ts"
found_in:
  change: "01M5TJYB18G4MFYZNWKKGCFJW9"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "425309d6-34dc-40a5-8b76-819d7cb8a08b"
created_at: "2026-10-26T09:03:46.244Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The change cost total is summed from transcript messages only. A High Table seat whose exact token figure comes from the host, with no matching transcript, shows its tokens on its own Cost row and seat drill-down, but those tokens are not in the total. A sealed total can then read lower than the sum of the seat rows (or 0 when only seats ran).

Since ae5982b0 the seat's money figure is dropped when the host and transcript token figures differ, so tokens and money no longer disagree on one row. Only the total is left.

## Fix

Add host-only seat tokens to the total in src/cost/change-cost.ts (seatLines and the total fold), or label the total as partial when any seat figure is host-only.
