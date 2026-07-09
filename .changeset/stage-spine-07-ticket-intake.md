---
'paqad-ai': minor
---

Stage-Spine 07 (#322): deterministic ticket intake — make "do PQD-123" fetch the real ticket.

Wires the front door of the ticket → PR loop so the spec grounds in the actual ticket text
instead of a guess from the id:

- **`paqad-ai intake fetch <ref>`** — GitHub issues via `gh issue view` (mapped through a new
  `GithubIssuesTicketProvider`), Jira via the Atlassian MCP in-session; prints the normalized
  ticket and records an optional `ticket_intake` stage row. Graceful when `gh` is absent or the
  ref is unrecognised; intake is a bookend and never blocks a change.
- **Prompt-seam detector** (`detectTicketRefs`) + a Claude-Code `UserPromptSubmit` arming hook:
  a ticket ref in a prompt surfaces a `▸ paqad` line pointing at `intake fetch`. Advisory on
  hosts without the seam.
- Adds an optional "Stage 0 — ticket_intake" to the feature-development rule and fixes the
  `conventions.intake_decisions` → `process.intake_decisions` key mismatch in the policy text.
