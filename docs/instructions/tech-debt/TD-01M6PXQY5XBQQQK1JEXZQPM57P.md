---
id: "TD-01M6PXQY5XBQQQK1JEXZQPM57P"
title: "parseBranchTickets reads a leading number as a ticket whatever the template says"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/delivery/commit-split.ts"
  - "src/planning/ticket-ref-detect.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:37:16.800Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`parseBranchTickets` in src/planning/ticket-ref-detect.ts reads any number at the start of the branch's last segment as a GitHub ticket and never looks at the team's template. `feature/2024-plan` gives ticket 2024, and so does any leading number under a `{prefix}/{title_slug}` template or on a Jira-only team. `ticketInBranch` now gives no ticket on many of the same names, so the two readers of one branch disagree.

It is narrower than the bug fixed in `ticketInBranch`, because a number later in the name, like `round-5`, gives nothing.

## Why it matters

`changeOwnTickets` in src/delivery/commit-split.ts uses it when the change has no issue, and `computeCommitSplit` treats a commit tagged with a different ticket as foreign. A false own ticket can therefore report the change's commits as inherited in the delivery record and the HUD. I read this path and did not reproduce it end to end. It does not block anything.

## Fix

Pass the workflow config in and read the template slot, sharing the logic in `ticketInTemplateSlot`. The cases `feat/12-34-two-tickets` and `fix/7` in tests/unit/delivery/commit-split.test.ts are intended and need a decision if that template does not allow them.
