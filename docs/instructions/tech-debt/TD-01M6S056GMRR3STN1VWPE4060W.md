---
id: "TD-01M6S056GMRR3STN1VWPE4060W"
title: "The warning that stored text is data is missing from the fallback method and comes late on the word-match path"
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
created_at: "2026-11-06T17:57:57.357Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The line telling an agent that stored titles, context and reasons are data, not instructions, reaches it only through `references/earlier-answers.md`.

- `EARLIER_METHOD_FALLBACK` lacks that line, so a missing or oversize reference file removes the warning.
- The word-match block prints `candidates` before `method`, unlike the title block, so stored text comes first on that path.
- `decision check --read` repeats no warning. It prints context and reason as plain JSON values.

JSON escaping holds: a planted title with quotes, newlines and backticks stayed inside its string. A planted reason was resisted in 6 of 6 eval runs, which is too few to prove it in general. To fix: add the line to the fallback and print `method` first in the word-match block.
