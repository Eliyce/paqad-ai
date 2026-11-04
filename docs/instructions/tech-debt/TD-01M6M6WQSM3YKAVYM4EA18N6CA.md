---
id: "TD-01M6M6WQSM3YKAVYM4EA18N6CA"
title: "Finish the stage recipe measurement and retire what nothing uses"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "scripts/skill-consumer-scan.mjs"
  - "scripts/stage-benchmark.mjs"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "checks"
found_by: "paqad-development"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-04T21:19:28.023Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Part 6 of the stage recipe work shipped a reduced sample: 12 real runs, one past task per stage in two arms. These stay open as follow-ups, on purpose, by the owner's ruling:

- three runs per arm on 10 to 20 past tasks per stage, cheap and strong tiers, through the eval engine
- the pass^3 threshold per stage agent
- setting maxTurns from the arm B medians plus 50 percent, in place of the starting budgets
- retiring the base skills the consumer scan lists with no consumer and no activation in 30 days, through the skill retirement flow. Each recipe has its source skills listed beside it in .paqad/authoring/stage-recipes/consumer-scan.json, because recipe text and its sources are two copies that can drift until then

Nothing was retired and maxTurns was not changed from the sample.
