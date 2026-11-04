---
id: "TD-01M6HVAANTK0X4AJW2Z5FWEEE6"
title: "A failed rule-script map drop during update is not retried and its note names no recovery"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/update/updater.ts"
found_in:
  change: "01M6HHDVSS4MZFF3KZBTEPN2KV"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "0c5e7458-3c33-4900-93fc-d6c7624e21bc"
created_at: "2026-11-03T23:18:41.569Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

When dropRuleScriptMapSources fails during paqad-ai update (src/update/updater.ts:180), the rule file is already gone, so the next update has nothing to remove and does not retry the drop. The map keeps those entries, and the reconciler reports RS-RULE-REMOVED for each one. The Couldn't drop note does not say how to recover. This should be rare, because it needs an unreadable or unwritable map.

## Fix

Name the recovery in the note, or retry by dropping any map entry whose source is one of the seven paths and whose file is gone.
