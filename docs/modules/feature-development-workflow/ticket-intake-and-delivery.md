# Feature Development — `ticket_intake` and `delivery` bookend stages

> **Status:** stable since #42 &nbsp;·&nbsp; **Owner:** framework-internals

## Stage order today

```
ticket_intake → planning → specification → development → review → checks → documentation_sync → delivery
```

Both new stages are framework-owned (defined in
[`src/pipeline/feature-development-policy.ts`](../../../src/pipeline/feature-development-policy.ts))
and project-overridable via `merge_mode: append` in
`docs/instructions/workflows/feature-development.yaml` — exactly like every
other stage. The JSON schema
([`feature-development-policy.schema.json`](../../../src/validators/schemas/feature-development-policy.schema.json))
rejects unknown stage names with `additionalProperties: false`.

## `ticket_intake`

Runs **before `planning`**. Triggered when the request references a ticket
*or* when a ticket-provider MCP server is configured (see
[`mcp.servers[].kind`](../../../src/validators/schemas/project-profile.schema.json)).

### Sub-flow

1. **Fetch** — pull the ticket via the configured ticket-provider MCP.
2. **Ground** — load repo rules, stack, design-system, implicated module
   docs (via the existing `scope-check` + `cross-module-impact-scanner`
   skills under `runtime/base/skills/`), and the prior decision corpus.
3. **Refine** — invoke `requirement-analyst`, `story-designer`,
   `requirement-enrichment` skills (already in `runtime/base/`) to tighten
   the description, derive AC, mark in/out of scope, and list implicated
   modules.
4. **Elicit decisions** — for every open choice the refined ticket implies:
   - **Priors first.** Call
     [`findIntakePriorMatch`](../../../src/planning/intake-prior-resolver.ts).
     If the fingerprint hits, pre-fill `human_response.chosen_option_key`
     with the prior's value and `human_response.note` with a citation back
     to the prior `D-{N}`.
     [`DecisionStore.findReusableDecision`](../../../src/planning/decision-store.ts)
     emits the `decision-reused` audit event on every hit.
   - **Rules second.** If a repo rule answers the question, treat the rule
     path as the source and cite it in the note.
   - **Ticket third.** If the ticket body or AC already pin the answer,
     capture it as a confirmed packet.
   - **Otherwise ask.** Write a `pending` packet with the agent's best
     guess in `recommendation` and a ≤4-option list. The workflow stops
     until the user resolves it.
5. **Confirm auto-resolutions.** When N decisions were auto-resolved,
   surface them per
   [`conventions.intake_decisions.confirm_auto_resolutions`](../../../src/core/conventions.ts)
   (default `batched`). The batched-confirm primitive is in
   [`src/planning/batched-confirm.ts`](../../../src/planning/batched-confirm.ts);
   single-packet flow stays the default for every other category.
6. **(Optional) Write-back** — propose updating the source ticket with
   the refined description + AC + linked decisions, gated by
   `conventions.ticket.write_back: never | ask | always`.

Failure modes:

- `escalation.missing_ticket: warn` — proceed without a ticket if the
  request is natural language and no provider is configured.
- `escalation.unresolved_decisions: stop` — any `pending` packet at the
  end of intake blocks the rest of the workflow.

## `delivery`

Runs **after `documentation_sync`** as the final stage. Asks a
`delivery.open_pr` Decision Packet (`yes | draft | no`). On `yes` or
`draft` it renders branch / commit / PR text from the conventions block
(see below) and runs the sequence through
[`src/delivery/runner.ts`](../../../src/delivery/runner.ts):

1. `git checkout -b <branch>`
2. `git commit -m <message>`
3. `git push --set-upstream origin <branch>`
4. `gh pr create …` (with `--draft` when applicable)

Every failure short-circuits with an actionable remediation hint —
`escalation.remote_failure: stop`. There is no silent local-only fallback.

[`detectDeliveryHost`](../../../src/delivery/host.ts) recognises GitHub,
GitLab, and Bitbucket from the remote URL. GitHub is automated today via
`gh`; GitLab / Bitbucket are detected but route to a manual-PR
remediation message until a follow-up wires their CLIs.

## The `conventions:` block

Project-owned conventions consumed by both bookend stages.
[`DEFAULT_CONVENTIONS`](../../../src/core/conventions.ts) is the runtime
source of truth; the JSON schema's
`$defs/conventionsBlock` is the validation source of truth.
[`resolveConventions`](../../../src/core/conventions.ts) shallow-merges
project overrides over the per-section defaults so every field is
populated for downstream consumers.

```yaml
conventions:
  ticket:
    provider: jira
    server: ""
    require_ticket: false
    write_back: ask
  intake_decisions:
    auto_resolve_from_priors: true
    auto_resolve_from_rules:   true
    confirm_auto_resolutions:  batched
    max_options_per_packet:    4
    fingerprint_scope: [ticket_type, module, category]
  branch:
    template: "{type}/{ticket}-{title_slug}"
    type_map: { Story: feat, Bug: fix, Task: chore, default: feat }
    slug_max_length: 50
    base: main
  commit:
    template: "{type}({scope}): {summary}\n\nRefs: {ticket}"
    sign_off: false
  pr:
    title_template: "{type}({scope}): {summary} [{ticket}]"
    body_template_path: .paqad/templates/pr-body.md
    base: main
    draft: false
    reviewers: []
    labels: []
    link_ticket: true
    transition_on_open: "In Review"
```

Schema validation rejects unknown keys at the `conventions.*` path.

## New Decision categories

Four bookend categories were added to `DECISION_CATEGORIES` in
[`src/planning/decision-packet.ts`](../../../src/planning/decision-packet.ts):

| Category | Used by |
| --- | --- |
| `intake.requirement` | A choice the refined ticket needs pinned. |
| `intake.confirm_auto_resolution` | The batched "we resolved N from priors, accept or override" prompt. |
| `intake.write_back` | Source-ticket write-back confirmation. |
| `delivery.open_pr` | The PR creation gate (yes / draft / no). |

All four ride the existing `pending → resolved` lifecycle, audit log,
and TTL machinery. `DECISION_CATEGORY_DEFAULTS` lists their `create_new`
flag, `reversibility`, and `ttl_days`.

## Related

- [Decision Pause Contract managed-doc architecture](../decision-pause-contract/managed-doc-architecture.md)
- [`src/pipeline/feature-development-policy.ts`](../../../src/pipeline/feature-development-policy.ts)
- [`src/core/conventions.ts`](../../../src/core/conventions.ts)
- [`src/planning/intake-prior-resolver.ts`](../../../src/planning/intake-prior-resolver.ts)
- [`src/planning/batched-confirm.ts`](../../../src/planning/batched-confirm.ts)
- [`src/delivery/`](../../../src/delivery/)
