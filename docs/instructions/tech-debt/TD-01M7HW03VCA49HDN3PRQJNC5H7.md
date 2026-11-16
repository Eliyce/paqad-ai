---
id: "TD-01M7HW03VCA49HDN3PRQJNC5H7"
title: "onboarding commit verb cannot tell a person's answer from an agent's on hosts without the ask permission"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/onboarding/journey/commit.ts"
found_in:
  change: "01M7HN6CN644C9ZZQE1MQ3K0N0"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "2186460c-1786-5c20-a493-5758cd0ebc53"
created_at: "2026-11-16T09:46:17.193Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

INV-7 says the commit verb refuses without an explicit answer from a person, even if an agent skips the skill wording. The verb accepts --branch from any caller. Only the Claude Code ask entry forces a human prompt, so on Codex, Cursor or Gemini an agent can commit unprompted. Record the answer source (tray or agent-attested) the way start does, or require a tray or answer token.
