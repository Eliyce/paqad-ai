# Provider-Agnostic Delivery Workflow

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `delivery-workflow` &nbsp;·&nbsp; **Issue:** #42

## Purpose

Every team follows its own delivery ritual — which branch to cut from, how to
name it, when CI must be green, which ticket status means what, what gets written
back to the tracker. There is no industry standard. So paqad does **not** ship a
structure and does **not** make the team author one: the feature is **on and
automatic by default**, its conventions are **detected from the team's real git
history**, and the work it automates runs through **two provider-neutral
contracts** so Jira + GitHub are the first adapters, not the design.

## The two contracts (the headline)

The capability *is* the contract; vendors are adapters behind it.

| Contract | File | First adapter | Operations |
| -------- | ---- | ------------- | ---------- |
| `TicketProvider` (tracker-neutral) | `src/providers/ticket-provider.ts` | Jira (`src/providers/jira-ticket-provider.ts`) | fetchTicket, listTransitions, transition, addComment, updateFields |
| `HostProvider` (VCS + code-host-neutral) | `src/providers/host-provider.ts` | GitHub (`src/providers/github-host-provider.ts`) | ensureBranch, commit, push, openPR, getChecksStatus |

`NormalizedTicket` is the seam Linear / GitHub-Issues map onto later; GitLab /
Bitbucket are additive `HostProviderKind` values. A provider is resolved from the
delivery-policy + the MCP `kind` discriminator by `src/providers/registry.ts`,
which also reports whether the provider is **connected** — the input to graceful
degradation and the dashboard.

## Config — a workflow-policy peer

`docs/instructions/workflows/delivery-policy.yaml` is authored exactly like
`feature-development.yaml`: same location, same JSON-Schema validation
(`src/validators/schemas/delivery-policy.schema.json`), same `merge_mode: append`
precedence. `paqad-ai onboard` writes it `enabled: true` with every section
`maintained: auto`.

| Section | Owns |
| ------- | ---- |
| `ticket` | provider/server, require_ticket, write_back_refined, comment_decisions |
| `host` | provider/server |
| `branch` | template, type_map, slug_max_length, base |
| `commit` | template, sign_off |
| `pr` | title/body templates, base, draft, reviewers, labels, link_ticket, transition_on_open |
| `ci` | gate (wait_for_green/warn_only/off), timeout_minutes, on_red, transition_on_green |
| `intake_decisions` | priors/rules auto-resolution, confirm mode, fingerprint scope |

Each section carries `maintained: auto | manual`. `auto` lets detection keep it
in sync; `manual` is team-owned and **never** auto-touched.

## Detection rides `create documentation`

`src/delivery/detection.ts` is a pure resolver: given a `GitSnapshot` (remote,
default branch, branch names, recent commit subjects) it infers host / base /
branch-template / commit-convention, each with a confidence and evidence string.
`create documentation` (the post-onboard repo scan) piggybacks it via
`src/delivery/detect-run.ts` and **silently fills the `auto` sections**, showing
what it set in the end-of-docs summary plus one combined "connect GitHub + Jira"
nudge.

Precedence at load time (`loadDeliveryPolicy`):
**framework defaults < detection overlay (auto sections only) < project YAML.**
Detection is persisted to a side artifact (`.paqad/delivery-detection.json`) so
the commented `delivery-policy.yaml` is never rewritten.

## Stages — `ticket_intake` and `delivery`

Two real, hard-coded bookend stages in `STAGE_ORDER`
(`src/pipeline/feature-development-policy.ts`): `ticket_intake` (before
`planning`) and `delivery` (after `documentation_sync`). The generality lives in
the provider layer, not a stage registry.

- **CI gate** (`src/delivery/ci-gate.ts`): `wait_for_green` polls
  `getChecksStatus` until green (bounded by `timeout_minutes`), applies `on_red`
  on failure, and reports `transition_on_green`. The clock + sleep are injected
  so the poll loop is unit-testable.
- **Graceful degradation** (`src/delivery/degradation.ts`): when a required
  provider is not connected, git-only steps still run, provider-bound steps are
  skipped, and the connect nudge is re-surfaced — never a hard stop.
- **Decision categories**: `delivery.open_pr` (PR gate) and `delivery.ci_red`
  (red build needing a human call) follow the existing Decision Pause Contract.

## On-disk + dashboard

| Path | What |
| ---- | ---- |
| `docs/instructions/workflows/delivery-policy.yaml` | the policy (project-owned, onboard-written) |
| `.paqad/delivery-detection.json` | detected conventions + evidence (overlay source) |
| `.paqad/templates/pr-body.md` | PR body template referenced by `pr.body_template_path` |

The **Delivery Workflow** dashboard section (`src/dashboard/collectors/delivery.ts`)
shows configured/active state and the resolved provider connections
(GitHub ✓ / Jira ✗), also surfaced in `paqad-ai status`.

## Boundaries

- **Owns:** the provider contracts + Jira/GitHub adapters, the delivery-policy
  schema/loader/onboard writer, convention detection + overlay, the CI gate, the
  degradation planner, and the dashboard section.
- **Does not own:** the Decision Pause runtime (reused, not extended — no new
  autonomy mode); the feature-development stage engine (delivery is two stages in
  it); non-Jira trackers and non-GitHub hosts (additive adapters behind the
  day-one contracts).
