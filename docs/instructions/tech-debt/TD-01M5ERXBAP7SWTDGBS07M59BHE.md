---
id: "TD-01M5ERXBAP7SWTDGBS07M59BHE"
title: "CLI-resolved contract decisions never reach the decision index, so answered forks can be re-asked"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/decisions/authoring.ts"
  - "src/planning/decision-store.ts"
found_in:
  change: "01M5EQRYSFA51HDMC4XW13AFNB"
  issue: null
  stage: "documentation_sync"
found_by: "orchestrator"
session: "c4df07ba-554d-4d5d-b7d9-38d92761953b"
created_at: "2026-10-21T08:23:13.993Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Fixed in this change for hook-written packets: `paqad-ai decision resolve` crashed on them and, before that, never wrote the decision index, so the self-arm did not see an answered fork and opened it again. Contract packets created by `decision create` and resolved by the CLI still never reach the decision index (`DecisionStore.findReusableDecision` reads `.paqad/decisions/index.json`, which only `DecisionStore.resolve` writes), so evidence-armed and self-armed forks can re-ask a question the owner already answered through the CLI.
