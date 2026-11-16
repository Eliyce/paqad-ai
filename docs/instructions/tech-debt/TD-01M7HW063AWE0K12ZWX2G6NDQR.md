---
id: "TD-01M7HW063AWE0K12ZWX2G6NDQR"
title: "Journey rules_before snapshot comes from the rule-script map, so pre-existing rules not yet mapped are treated as journey-added"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/onboarding/journey/actions.ts"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:19.475Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

startStage(rules_discovery) records ruleIds from loadRuleScriptMap. On a first onboarding the map is usually empty, so after analyze every existing rule that gets a new check is flagged warn_until_reviewed. Take the snapshot of rule ids from the rule files (the collectRuleFiles inventory) instead.
