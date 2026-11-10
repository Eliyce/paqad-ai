---
id: "TD-01M73HSSZQ9G7NXP5C4B84JFVZ"
title: "Rules discovery apply rerun skips rule-script map sync for an already-written added rule"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/rules-discovery/apply.ts"
found_in:
  change: "01M73AE41TYA4MJPNJZS30HMPE"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "47d0b214-1a99-540a-9748-0d7cf867e1a3"
created_at: "2026-11-10T20:18:42.724Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

In src/rules-discovery/apply.ts writeRow, the add path returns early when findWrittenRule finds the bullet already written by this run, and skips syncMap. If apply stops after addRule wrote the bullet but before syncMap/applyRuleScriptMap finished (or syncMap itself threw), the rerun never adds the rule to rule-script-map.yml, so the reconciler later reports the rule as added drift. Fix: on the already-written branch, call syncMap when the map has no entry for the id.
