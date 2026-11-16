---
id: "TD-01M7HW076PPPR6A1T6H4BENTQJ"
title: "onboarding commit checks out the new branch before committing, with no rollback if the commit fails"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/onboarding/journey/commit.ts"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:20.609Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

answerCommit runs git checkout -b, then git add and git commit. If a pre-commit hook or the commit fails, the person is left on the new branch with staged files and no commit record. Restore the previous branch on failure, or record the partial state.
