---
id: "TD-01M75DGS1H15VGN9KJ0MYFPXTN"
title: "Typed epic key read at step 4 is not placed inside or outside the run's read total"
kind: "gap"
severity: "low"
status: "open"
files:
  - "plugins/discovery/shared/references/ground-from-tracker.md"
  - "plugins/discovery/skills/decide-together/SKILL.md"
found_in:
  change: "01M74RZSDZGPCR87Y1SCXNRYQR"
  issue: "884"
  stage: "review"
found_by: "paqad-review"
session: "888e8869-7214-4b23-89ed-da242fe8ffa1"
created_at: "2026-11-11T13:42:21.446Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

FR-15 and INV-3 make 25 search results and 10 opened issues one total for the whole run, with only the read-only check before posting allowed on top. FR-47 reads a typed epic key at step 4. Neither the spec nor decide-together/SKILL.md says whether that step 4 read counts toward the 10, or what happens when the total is already used up and the person types a key. The skill follows the spec as written, so a typed key can push the run one read over the total. Settle it in the spec: either count the typed-key read toward the 10, or, once the total is used, skip the step 4 read and rely on the post-time verify.
