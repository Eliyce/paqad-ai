---
id: "TD-01M6KE5W2Y1ERT99AEMEMV09YC"
title: "No plan yet for an older paqad reading a higher schema_version"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "src/feature-evidence/git-hooks.ts"
  - "src/git-workflow/load.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: "documentation_sync"
found_by: "documentation_sync"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T14:07:32.931Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

No file has `schema_version` 2 yet, so nothing goes wrong today. When one does, two gaps open.

- `mergeGitWorkflow` in `src/git-workflow/load.ts` merges a file with a higher `schema_version` over the defaults and says nothing. Moved keys quietly fall back to defaults, and teammates get different gates.
- The `commit-msg` and `pre-push` lines in `src/feature-evidence/git-hooks.ts` end in `|| exit 1`, so an older paqad that fails to validate a moved layout could stop commits.

## Fix idea

With the first raise, add one doctor line naming the older paqad, decide what an older paqad does when it reads a moved layout, make sure a validation failure doesn't stop commits, and test it.
