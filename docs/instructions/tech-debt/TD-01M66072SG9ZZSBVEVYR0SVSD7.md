---
id: "TD-01M66072SG9ZZSBVEVYR0SVSD7"
title: "Duplicated block between adapter-onboarding and agent-runtime module summaries"
kind: "debt"
severity: "low"
status: "open"
files:
  - "docs/modules/adapter-onboarding/index/summary.md"
  - "docs/modules/agent-runtime/index/summary.md"
found_in:
  change: "01M65SFN9BMVXRVPPYN44SJEVQ"
  issue: "754"
  stage: "review"
found_by: "paqad-review"
session: "b56f5d5d-6913-44b6-a7b8-a4346eb0fd48"
created_at: "2026-10-30T08:53:24.894Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The review digest's duplication detector reports docs/modules/adapter-onboarding/index/summary.md:373-390 as 100% similar to docs/modules/agent-runtime/index/summary.md:71-86. The block predates the green-run reuse branch: `git diff main...HEAD` does not touch either file.

## Fix

Keep the text in one module summary and link to it from the other.
