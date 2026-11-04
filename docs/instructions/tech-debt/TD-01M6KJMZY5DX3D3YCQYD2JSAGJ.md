---
id: "TD-01M6KJMZY5DX3D3YCQYD2JSAGJ"
title: "The forceOverwrite onboarding option can overwrite a file written by a newer paqad"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/onboarding/file-writer.ts"
  - "src/onboarding/orchestrator.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: "review"
found_by: "paqad-review"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T15:25:42.698Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`OnboardingOrchestrator.run` takes a `forceOverwrite` option, and `writeGeneratedFiles` then overwrites every file on its list, including the git-workflow files from `src/git-workflow/onboard.ts`, with no `schema_version` check. A caller that sets it can change a file written by a newer paqad, which INV-4 does not allow.

## Why it is not fixed here

No command sets the option. Nothing in `src` passes it, and `onboard` has no `--force` flag, so only tests and direct API callers can reach it. The spec has no signed-off exception for it.

## Fix

Keep a file with a higher `schema_version` when `forceOverwrite` is set, and name it with the newer-file line.
