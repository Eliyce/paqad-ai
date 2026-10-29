---
id: "TD-01M63C5ZZYEV6MNKNBHSV6XQF8"
title: "Merged-PR close matches (#N) anywhere in a base-branch subject, not only at its end"
kind: "bug"
severity: "low"
status: "closed"
files:
  - "src/feature-evidence/abandon.ts"
found_in:
  change: "01M636XGSQWPQYWGN1YF9E39HB"
  issue: null
  stage: null
found_by: "paqad-review"
session: "5067f880-9a84-46e8-9d93-614ae3afaabe"
created_at: "2026-10-29T08:24:48.876Z"
reopened_at: null
issue: null
closed_reason: "The pull request number now matches only at the end of the subject (fix(feature-evidence): match the pull request number only at the end of the subject), with a failing test first."
---

## What

`squashSubjectOnBase` in src/feature-evidence/abandon.ts confirms a merge when any base-branch subject *contains* `(#<pr.number>)` (`subject.includes(needle)`). AC-10 says the subject *ends with* `(#N)`. A different squash subject that mentions the number mid-line, for example `fix: follow-up to the parallel review (#N) (#M)`, or a revert subject `Revert "feat: x (#N)"`, would close bundle N as done at once even while its own pull request is still open.

The tested negatives (a longer number with N as its prefix, a bare hash-N without parentheses, and a shorter prefix of N) are handled correctly. The only gap is a mid-subject match.

## Fix

Match the end of the subject: `subject.trimEnd().endsWith(needle)`. Add a negative test with `(#N)` in the middle of the subject and another number at the end.
