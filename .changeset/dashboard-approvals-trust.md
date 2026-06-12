---
'paqad-ai': minor
---

Add the approvals inbox and trust area to the dashboard (#146, scoped).

The dashboard gains two surfaces on top of the existing health view, for
onboarded projects:

**Approvals** is one inbox for everything waiting on the human: decision
pauses and proposed MD-XXXX module decisions, each with consequence lines per
option. Resolving on the web writes through the same `DecisionStore` and
module-decision state machine the agent uses, so the conversation picks the
answer up on its next tool call. Every web mutation is recorded with
`actor="dashboard"` in `.paqad/audit.log`.

**Trust** renders the proof: the evidence ledger as a filterable timeline, DSSE
receipts as cards with per-link seal verification and authorship, the
CycloneDX AI-BOM with download, and a "Copy as PR comment" action that emits
the exact Markdown `paqad-ai evidence` prints. View and export only, by
design.

Mutations are guarded: onboarded projects only, loopback host and same-origin
checks, 64 KB body cap, and a new `paqad-ai dashboard --read-only` flag that
disables every mutation endpoint for shared or CI usage.

Issue #146's full editing surface (web editors for instructions, workflows,
policies, tokens) is deliberately deferred; the scope decision and the market
evidence behind it are recorded in `docs/design/dashboard-approvals-trust.md`.
