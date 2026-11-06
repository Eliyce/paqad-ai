---
id: "TD-01M6RNC7D8DWKKZYAWWABEZ4T6"
title: "A hand-written standing rule skips a question with no proof anyone chose it"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/decisions/standing-answers.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T14:49:33.320Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`findStandingAnswer` trusts any well-formed row in `.paqad/decisions/standing-answers.json`. Reproduced: a hand-written rule with a matching fingerprint, `from_decision: D-NEVER` and no `standing-set` ledger row made `createPendingDecision` write a resolved packet with `responded_by: standing-answer` and print "I used your standing answer". A stage agent can write this file through Bash.

Damage is safe: invalid JSON, non-array rules, a key not in the options, a wrong fingerprint, an excluded category and non-string fields all opened a pending packet.

The labels are honest (`standing-answer`, never `human`) and a merged rule shows in the PR diff, so this is a rule nobody chose, not a forged human answer.

Fix direction: require `from_decision` to be a resolved packet in the same category with the same fingerprint and chosen key, answered by a person. That stops casual forging. Full proof depends on the person-proof debt item.
