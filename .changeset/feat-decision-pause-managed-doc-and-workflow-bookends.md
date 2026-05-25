---
'paqad-ai': minor
---

**#37 — Decision Pause Contract: ship the full resolution flow to every provider via one managed external doc**

- Onboarding now writes a canonical `.paqad/decision-pause-contract.md` (rule, categories sourced from `DECISION_CATEGORIES`, four-step resolution flow, per-adapter UI table, file-wait fallback) — re-runs are byte-identical when nothing changed.
- Every provider entry file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/…`, `.windsurf/rules/…`, `GEMINI.md`, `.junie/AGENTS.md`, `ANTIGRAVITY.md`, `.github/copilot-instructions.md`, `.continue/…`, `.aider.conf.yml`) now renders a thin pointer + a one-sentence per-adapter UI note (Claude Code → `AskUserQuestion`, Aider → `/ask`, etc.) from the new `decision-pause-ui-shim`.
- `paqad refresh --providers` re-renders entry files for adapters whose config exists on disk and rewrites the managed doc; it intentionally does not silently onboard new providers.
- Health check now compares each entry against its adapter's expected rendering and warns when the managed doc is missing, with a remediation hint pointing at `paqad refresh --providers`.

**#42 — `ticket_intake` + `delivery` bookend stages with priors-first decision elicitation**

- New stage order: `ticket_intake → planning → specification → development → review → checks → documentation_sync → delivery`. Both bookends are framework-owned and project-overridable via the existing `merge_mode: append` mechanism; the JSON schema rejects unknown keys with `additionalProperties: false`.
- New optional top-level `conventions:` block on the project profile covering `ticket / intake_decisions / branch / commit / pr`. `DEFAULT_CONVENTIONS` is the runtime source of truth; `resolveConventions` shallow-merges project overrides per section so every field is populated for downstream consumers.
- `mcp.servers[]` gains an optional `kind` discriminator (`jira | linear | github-issues | generic`); existing servers without `kind` keep validating.
- Four new `DECISION_CATEGORIES`: `intake.requirement`, `intake.confirm_auto_resolution`, `intake.write_back`, `delivery.open_pr`. All ride the existing pending → resolved lifecycle, audit log, and TTL machinery.
- `findIntakePriorMatch` is the dedicated priors-first entrypoint for intake; it computes the fingerprint and reuses the existing `DecisionStore.findReusableDecision` machinery, which already emits `decision-reused` audit events on every hit.
- New batched-confirm primitive (`BatchedConfirmRequest`, `applyBatchedAnswer`, `renderBatchedRow`) backs `intake.confirm_auto_resolution`. Single-packet flow remains the default for every other category.
- New `src/delivery/` modules: `templates.ts` renders branch / commit / pr_title / pr_body from the conventions block + inputs (slugify, conventional type mapping, `{placeholder}` substitution); `host.ts` detects the delivery host (GitHub today, GitLab / Bitbucket recognised); `runner.ts` sequences `git checkout -b → git commit → git push → gh pr create` through a dependency-injected `DeliveryShell` so unit tests don't touch a real remote. Every failure short-circuits with an actionable remediation hint — no silent local-only fallback.
- Default PR body template at `runtime/templates/pr-body.md.hbs`; projects can override with `.paqad/templates/pr-body.md`.
- Module docs: `docs/modules/decision-pause-contract/managed-doc-architecture.md` and `docs/modules/feature-development-workflow/ticket-intake-and-delivery.md`.
