---
id: "TD-01M6HTHEMMS1NK85TF0HHPXYHM"
title: "Onboarding an existing project again silently drops the script bindings of edited rules"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/onboarding/orchestrator.ts"
  - "src/rule-scripts/analyzer.ts"
found_in:
  change: "01M6HHDVSS4MZFF3KZBTEPN2KV"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "0c5e7458-3c33-4900-93fc-d6c7624e21bc"
created_at: "2026-11-03T23:05:06.431Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

src/onboarding/orchestrator.ts:294-295 recompiles the rule-script map whenever it is stale when an existing project is onboarded again. assembleMap carries a rule's scripts only when its text hash is unchanged, so a rule the team edited loses its script bindings. apply.ts then rewrites the integrity digest, and the reconciler reports no drift. No note tells the team. This behaviour predates this change.

## Fix

Keep the bindings visible: leave edited rules for the reconciler to report, or print which rules lost their scripts.
