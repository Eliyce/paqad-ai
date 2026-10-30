---
id: "TD-01M66073CWDQYAKH1READM94G5"
title: "Duplicated setup between spec-pipeline config test and feature-evidence receipt test"
kind: "debt"
severity: "low"
status: "open"
files:
  - "tests/unit/feature-evidence/receipt.test.ts"
  - "tests/unit/spec-pipeline/config.test.ts"
found_in:
  change: "01M65SFN9BMVXRVPPYN44SJEVQ"
  issue: "754"
  stage: "review"
found_by: "paqad-review"
session: "b56f5d5d-6913-44b6-a7b8-a4346eb0fd48"
created_at: "2026-10-30T08:53:25.515Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The review digest's duplication detector reports tests/unit/spec-pipeline/config.test.ts:10-19 as 100% similar to tests/unit/feature-evidence/receipt.test.ts:43-52. The block predates the green-run reuse branch: `git diff main...HEAD` does not touch either file.

## Fix

Move the shared setup into a helper under tests/unit/_helpers and import it from both tests.
