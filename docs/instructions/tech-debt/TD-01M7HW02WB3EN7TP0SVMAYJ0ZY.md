---
id: "TD-01M7HW02WB3EN7TP0SVMAYJ0ZY"
title: "Onboarding agents can write .paqad/onboarding/events.jsonl directly and forge unit or agent_bind rows"
kind: "gap"
severity: "medium"
status: "closed"
files:
  - "src/onboarding/journey/agents.ts"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:16.211Z"
reopened_at: null
issue: null
closed_reason: "Fixed in 568add6: events.jsonl and view.json are in the write-guard denied roots and the allow-list deny entries."
---

## What

ONBOARDING_WRITE_ROOTS allows .paqad/ and the allow list grants Write(.paqad/**). events.jsonl is not in the deny lists, so an onboarding agent's Edit/Write can append forged unit rows (which satisfy end-gate proofs) or agent_bind rows (which escape module-folder isolation). Add .paqad/onboarding/events.jsonl and view.json to ONBOARDING_DENIED_ROOTS and to the allow-list deny entries. Only the CLI should write them.
