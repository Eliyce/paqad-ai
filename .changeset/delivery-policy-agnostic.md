---
'paqad-ai': minor
---

Provider-agnostic delivery workflow (#42). The `ticket_intake` → `delivery`
loop is now configured by a standalone `delivery-policy.yaml` — a workflow-policy
peer of `feature-development.yaml` (same location, schema validation, and
`merge_mode: append` precedence) — on by default with every section
`maintained: auto | manual`.

- **Two provider-neutral contracts**: `TicketProvider` (Jira adapter) and
  `HostProvider` (GitHub adapter), resolved from config + the MCP `kind`
  discriminator. Linear / GitLab / Bitbucket are additive adapters.
- **Conventions are detected from git history** and silently fill the `auto`
  sections during `create documentation`, with an end-of-docs summary and one
  combined "connect GitHub + Jira" nudge. Detection persists to
  `.paqad/delivery-detection.json`; the commented policy file is never rewritten.
- **CI-wait gate** (`wait_for_green` / `warn_only` / `off`) with timeout and
  `on_red` handling, plus **graceful degradation** when a provider is not
  connected (git-only steps still run; provider-bound steps are skipped and
  re-nudged — never a hard stop).
- New **Delivery Workflow** dashboard section showing configured/active state and
  the GitHub/Jira connection.

The old `conventions:` block in the project profile is replaced by
`delivery-policy.yaml`.
