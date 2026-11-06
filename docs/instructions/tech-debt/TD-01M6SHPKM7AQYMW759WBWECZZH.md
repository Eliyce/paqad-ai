---
id: "TD-01M6SHPKM7AQYMW759WBWECZZH"
title: "Session resolution never reads the id the host exports as CLAUDE_CODE_SESSION_ID"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/cli/commands/route.ts"
  - "src/rag-ledger/session.ts"
found_in:
  change: "01M6SCTKHRJ3BVTHQY2T3XR3KV"
  issue: "831"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "950169d2-6a83-4705-9685-3a9e2bc76ca4"
created_at: "2026-11-06T23:04:33.636Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Commands resolve the session from `--session`, `SE_SESSION`, then `CLAUDE_SESSION_ID`. On Claude Code 2.1.317 the Bash tool environment carries `CLAUDE_CODE_SESSION_ID`, equal to the real session id, and not `CLAUDE_SESSION_ID`. No file under `src/` or `runtime/hooks/` reads `CLAUDE_CODE_SESSION_ID`, so every command run without the `SE_SESSION` prefix falls back to the shared cache file, in all workflows. The review of this change asks for the stage start and lane set fix on its own; this item is the rest: `route set`, `review`, `debt`, `checks` and the rule doc's `SE_SESSION=$CLAUDE_SESSION_ID` verify line.
