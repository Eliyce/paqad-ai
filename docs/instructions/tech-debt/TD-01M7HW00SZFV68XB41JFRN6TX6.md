---
id: "TD-01M7HW00SZFV68XB41JFRN6TX6"
title: "Onboarding module agents bind to module folders in claim order, not by the slug in their brief"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/onboarding/journey/agents.ts"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:14.120Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

recordOnboardingAgentStart binds each new paqad-onboarding-modules agent to the next claimed-but-unbound slug (nextUnboundModule). If the driver dispatches agents in a different order than it ran the claims, agent A is scoped to module B's folder. Mostly fails closed (A cannot write its own folder) but can let A write into B. Bind by the slug named in the dispatch or brief instead.
