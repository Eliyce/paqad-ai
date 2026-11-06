---
id: "TD-01M6RNCA6NH470705MVB461QSS"
title: "Standing answers drop malformed rows on write and rule answers show as earlier answers"
kind: "debt"
severity: "low"
status: "open"
files:
  - "src/decisions/earlier-answers.ts"
  - "src/decisions/standing-answers.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T14:49:36.179Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Two small standing-answer edges from the one-click earlier answers change.

1. `addStandingAnswer` and `removeStandingAnswer` read through a filter that drops malformed rows, then write the filtered list back. A malformed row, perhaps one a person could repair, disappears with no ledger row.
2. A packet a rule answered stays a candidate for `findEarlierQuestions`, with `why: "Standing answer R-..."`. After `standing remove` or with `--ask-anyway`, the rule's own output is offered as an earlier answer. A person is still asked, so nothing is skipped.
