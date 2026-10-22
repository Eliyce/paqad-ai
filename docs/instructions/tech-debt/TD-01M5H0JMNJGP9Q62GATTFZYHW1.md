---
id: "TD-01M5H0JMNJGP9Q62GATTFZYHW1"
title: "stage-guardrail AC-69 test is flaky under full-suite load"
kind: "debt"
severity: "medium"
status: "open"
files:
  - "tests/unit/guardrails/stage-guardrail.test.ts"
found_in:
  change: "01M5FTB2H17C1WTKHNGVTZVZQJ"
  issue: "713"
  stage: null
found_by: "review"
session: "e99f1b6e-48f6-45a4-a6f4-6cfac09ea07f"
created_at: "2026-10-22T05:15:40.584Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The `stage-guardrail` test for AC-69 (`tests/unit/guardrails/stage-guardrail.test.ts`) passes alone but fails intermittently under full-suite load, which looks timing-dependent. Seen during development of the dependency and Voyage removal change; the change does not touch that test or its subject. Needs a deterministic clock or a looser timing assumption, or a flaky-registry entry with an owner.
