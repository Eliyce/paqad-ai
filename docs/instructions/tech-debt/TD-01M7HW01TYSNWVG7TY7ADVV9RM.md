---
id: "TD-01M7HW01TYSNWVG7TY7ADVV9RM"
title: "Plugin mod register.tsx is outside every tsc project, so its onboarding wiring is not type-checked"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:15.140Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

runtime/claude-plugin/mod/register.tsx gained about 190 lines of onboarding band, tray and ledger wiring, but no tsconfig includes it. Only the mod-source string tests cover it. Add it to a typecheck project.
