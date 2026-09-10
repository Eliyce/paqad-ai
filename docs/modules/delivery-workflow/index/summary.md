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
`writeDetection` persists each run to TWO sinks together (so they never drift): the
side artifact (`.paqad/delivery-detection.json`) the loader overlays + the
documentation workflow reports, and a `delivery-evidence` row on the session-ledger
(`src/delivery/delivery-ledger.ts`, a project-scoped doc). Buildout F6 (decision D1
hard cutover): the **dashboard** reads the current detection from the ledger
exclusively — a file present without a ledger row is invisible to it — while the
loader keeps reading the file (operational).

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

## AI attribution — keeping the vendor out of the contributor graph (issue #538)

A coding agent writes its own vendor's attribution into the change it produces:
Claude Code appends a `Co-Authored-By: Claude` trailer to the commit and an
attribution line to the PR body, Cursor appends "Made with Cursor", and so on.
paqad writes none of those strings. The trailer is what makes a git host list the
AI vendor as a **contributor** on the repository, which is the part an enterprise
buyer rejects: their history and their contributor list end up naming an outside
vendor.

One floored knob decides the posture: **`ai_attribution`** (`keep` | `strip`,
default **`strip`**, policy group, resolved by
`src/delivery/attribution-config.ts`). Like the other enforcement knobs, the team
value is a floor — a developer's local config or `PAQAD_AI_ATTRIBUTION` may raise
it but never lower it, so dropping the policy takes a reviewable team commit.

**In scope: the host agent only.** paqad's own
`🤖 Generated with paqad-ai delivery` footer stays, by resolved decision
(`D-01M2591H8DFAD1AK6JG1SFZWYV`) — paqad is the customer's own governance tool,
not a third-party AI vendor, and that footer is a feature they bought. Every
pattern in the marker table is anchored on a vendor name so the footer, and a
human colleague's co-author trailer, are never matched.

Coverage is honest about what config can and cannot reach. Only two providers
expose a **project-level** knob paqad may write at onboarding; the rest keep
their switch in the developer's home directory, which paqad will not touch.

| Provider | Attributes by default | How paqad covers it |
| --- | --- | --- |
| Claude Code | yes | **Configured** — `attribution: { commit: '', pr: '', sessionUrl: false }` in `.claude/settings.json` (never the deprecated `includeCoAuthoredBy`) |
| Aider | yes, and it rewrites the git author + committer too | **Configured** — `attribute-author`, `attribute-committer`, `attribute-co-authored-by` false in `.aider.conf.yml` |
| Cursor | yes | **Backstop only** — its switch lives in `~/.cursor/cli-config.json` or the admin dashboard |
| Codex CLI | yes, configurable | **Backstop only** — its switch lives in `~/.codex/config.toml` |
| GitHub Copilot | commits under its own identity | **Backstop only** — controlled by org Copilot policy |
| Gemini CLI | no | **Backstop only** — nothing to configure |

Both writers merge rather than overwrite, so a value the team set by hand (a
house trailer instead of no trailer, say) survives re-onboard.

The **backstop** is what makes the promise true on the four providers config
cannot reach. At the completion seam `evaluateDelivery` scans the branch's commit
messages and, when `gh` answers, the PR body, and emits one `ai-attribution`
finding per vendor detected, carrying that vendor's exact remediation. It is
**warn-only** and never blocks — delivery is warn-floor, and this stays inside it.

## On-disk + dashboard

| Path | What |
| ---- | ---- |
| `docs/instructions/workflows/delivery-policy.yaml` | the policy (project-owned, onboard-written) |
| `.paqad/delivery-detection.json` | detected conventions + evidence (operational overlay source, loader-read) |
| `.paqad/ledger/delivery-evidence/_project/` | session-ledger doc the dashboard/SIEM read (F6) |
| `.paqad/templates/pr-body.md` | PR body template referenced by `pr.body_template_path` |

The **Delivery Workflow** dashboard section (`src/dashboard/collectors/delivery.ts`)
shows configured/active state and the resolved provider connections
(GitHub ✓ / Jira ✗), also surfaced in `paqad-ai status`. It reads the current
detection from the `delivery-evidence` ledger doc (F6), not the legacy file.

## Boundaries

- **Owns:** the provider contracts + Jira/GitHub adapters, the delivery-policy
  schema/loader/onboard writer, convention detection + overlay, the CI gate, the
  degradation planner, the dashboard section, and the AI-attribution policy (the
  `ai_attribution` knob, the vendor marker table, and the delivery backstop).
- **Does not own:** the Decision Pause runtime (reused, not extended — no new
  autonomy mode); the feature-development stage engine (delivery is two stages in
  it); non-Jira trackers and non-GitHub hosts (additive adapters behind the
  day-one contracts).
