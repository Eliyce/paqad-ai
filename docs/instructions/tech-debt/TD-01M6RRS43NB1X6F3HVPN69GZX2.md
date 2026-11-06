---
id: "TD-01M6RRS43NB1X6F3HVPN69GZX2"
title: "A write-in answer does not stop the older answer to the same question being offered"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/decisions/earlier-answers.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T15:49:01.651Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

An answer given as a write-in does not stop an older answer to the same question from being offered.

`sameQuestionKey` (`src/decisions/earlier-answers.ts:67-70`) compares the set of option keys, as FR-7 says. `decision resolve --other` adds an `other` option to the packet, so the write-in's key set differs from the original question's. The two land in separate groups and the older answer stays a candidate.

Reproduced: an answer with key `a`, then the same question answered with `--other "in the wiki"`. `findEarlierQuestions` returns both. The new packet has no `other` key, so only the older answer can be suggested.

That works against the aim of FR-6, that a changed answer isn't suggested again. A person still approves every suggestion and the write-in shows as a candidate beside it, so nothing is skipped.

Fix direction: leave write-in keys out of the comparison, and treat a write-in answer as the group's newest.
