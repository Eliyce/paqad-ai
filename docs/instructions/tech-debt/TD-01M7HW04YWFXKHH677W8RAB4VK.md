---
id: "TD-01M7HW04YWFXKHH677W8RAB4VK"
title: "onboarding decide auto-answers any pending packet opened after the journey started, including other sessions' packets"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/onboarding/journey/auto-decide.ts"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:18.320Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

autoDecide only checks packet.created_at >= run.created_at. A decision opened by a concurrent feature-development session in the same repo can be auto-resolved by the journey. Limit it to packets whose session or stage belongs to the journey.
