---
id: "TD-01M73HSTY0VSMV9F4D4722AWHW"
title: "Ordinary rule edits drop the discovered run from the rule marker"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/rule-scripts/editor.ts"
found_in:
  change: "01M73AE41TYA4MJPNJZS30HMPE"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "47d0b214-1a99-540a-9748-0d7cf867e1a3"
created_at: "2026-11-10T20:18:43.691Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

src/rule-scripts/editor.ts editRuleText rebuilds the bullet and calls embedRuleMarker without the discovered run, so any later normal rule edit drops the discovered:<run_id> part of the marker. traceDiscoveredRule then returns null for that rule. Decide whether ordinary edits should carry the existing discovered run forward.
