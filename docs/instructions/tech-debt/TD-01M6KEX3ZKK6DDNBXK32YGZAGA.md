---
id: "TD-01M6KEX3ZKK6DDNBXK32YGZAGA"
title: "The same regular expression escape helper is copied across six source files"
kind: "debt"
severity: "low"
status: "open"
files:
  - "src/core/framework-config.ts"
  - "src/core/team-config-retired.ts"
  - "src/git-workflow/patterns.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: "review"
found_by: "paqad-review"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T14:20:14.679Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`escapeRegExp` is written locally in six source files (`src/authoring/lint/never-write.ts:79`, `src/checks/testing-record.ts:222`, `src/core/framework-config.ts:1329`, `src/core/team-config-retired.ts:133`, `src/feature-evidence/mint.ts:76`, `src/git-workflow/patterns.ts:30`), and `src/git-workflow/defaults.ts` holds the same escape inline. No shared helper exists to reuse.

## Why it is not fixed here

Five copies predate this change. Moving them all is unrelated to the team file freeze.

## Fix

Export one helper from a shared text module and replace every copy.
