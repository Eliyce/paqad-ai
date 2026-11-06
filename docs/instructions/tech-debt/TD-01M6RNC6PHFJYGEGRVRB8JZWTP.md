---
id: "TD-01M6RNC6PHFJYGEGRVRB8JZWTP"
title: "A pause does not stop Bash edits and nothing proves a person answered"
kind: "gap"
severity: "high"
status: "open"
files:
  - "src/decisions/authoring.ts"
  - "src/decisions/standing-answers.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T14:49:32.592Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Named by the Out of scope section and FR-62 of the one-click earlier answers change. Two existing gaps stay open.

1. A decision pause does not stop edits made through Bash.
2. Nothing proves a person answered. Reproduced on that branch: with SE_AGENT_ID set, `decision suggest <id> --none --reason x` then `resolvePendingDecision` closes a required packet and stamps `human_response.responded_by: human`.

That change widens what the second gap can do. `--always` is refused only when SE_AGENT_ID is non-blank (`assertNotStageAgent`), and a stage agent exports that variable itself because its brief tells it to. An agent that leaves it unset, or the main conversation with nobody asked, can set a rule that skips the question for the whole team until removed.

Fix direction: a person-only signal the agent cannot write, such as a host question-tool result or a signed Approvals action, and a block on Bash writes during a pause.
