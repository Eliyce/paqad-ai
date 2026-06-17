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
     to the prior `D-{id}`.
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
   `process.intake_decisions.confirm_auto_resolutions` in
   [`delivery-policy.yaml`](../../../src/pipeline/delivery-policy.ts)
   (default `batched`). The batched-confirm primitive is in
   [`src/planning/batched-confirm.ts`](../../../src/planning/batched-confirm.ts);
   single-packet flow stays the default for every other category.
6. **(Optional) Write-back** — propose updating the source ticket with
   the refined description + AC + linked decisions, gated by
   `process.ticket.write_back_refined: never | ask | always`.

Failure modes:

- `escalation.missing_ticket: warn` — proceed without a ticket if the
  request is natural language and no provider is configured.
- `escalation.unresolved_decisions: stop` — any `pending` packet at the
  end of intake blocks the rest of the workflow.

## `delivery`

Runs **after `documentation_sync`** as the final stage. Asks a
`delivery.open_pr` Decision Packet (`yes | draft | no`) unless `process.pr`
already pins it. The branch / commit / PR text is rendered from the
delivery-policy `process:` block (see below) via
[`src/delivery/templates.ts`](../../../src/delivery/templates.ts), and the host
operations run through the **`HostProvider`** contract
([`src/providers/host-provider.ts`](../../../src/providers/host-provider.ts),
GitHub adapter at
[`github-host-provider.ts`](../../../src/providers/github-host-provider.ts)):

1. `ensureBranch(name, base)` — cut from the configured base
2. `commit(message)`
3. `push(branch)`
4. `openPR({ … })` (with `--draft` when applicable)
5. **CI gate** ([`src/delivery/ci-gate.ts`](../../../src/delivery/ci-gate.ts)) —
   `process.ci.gate = wait_for_green` polls `getChecksStatus` until green
   (bounded by `timeout_minutes`), applies `on_red`, and reports
   `transition_on_green`.

**Graceful degradation** ([`src/delivery/degradation.ts`](../../../src/delivery/degradation.ts)):
when a required provider's MCP / CLI is not connected, git-only steps still run,
the provider-bound steps are skipped, and the connect nudge is re-surfaced — it
does **not** hard-stop. Genuine git / remote failures (auth, conflicts, branch
protection) still `stop` with remediation — no silent local-only fallback.

Provider resolution (and connection state, which drives degradation + the
dashboard) lives in
[`src/providers/registry.ts`](../../../src/providers/registry.ts).

## The delivery-policy `process:` block

Conventions are configured by
[`docs/instructions/workflows/delivery-policy.yaml`](../../../src/pipeline/delivery-policy.ts)
— a workflow-policy peer of `feature-development.yaml` (same location, schema,
and `merge_mode: append`). `paqad-ai onboard` writes it `enabled: true` with
every section `maintained: auto`; detection silently fills the `auto` sections
during `create documentation`.
[`defaultDeliveryProcess`](../../../src/pipeline/delivery-policy.ts) is the
runtime source of truth;
[`delivery-policy.schema.json`](../../../src/validators/schemas/delivery-policy.schema.json)
is the validation source of truth.

```yaml
enabled: true
process:
  ticket:   { maintained: auto, provider: jira, write_back_refined: ask, comment_decisions: true }
  host:     { maintained: auto, provider: github }
  branch:   { maintained: auto, template: "{type}/{ticket}-{title_slug}", base: main }
  commit:   { maintained: auto, template: "{type}({scope}): {summary}\n\nRefs: {ticket}" }
  pr:       { maintained: auto, body_template_path: .paqad/templates/pr-body.md, transition_on_open: "In Review" }
  ci:       { maintained: auto, gate: wait_for_green, timeout_minutes: 30, on_red: stop, transition_on_green: "Done" }
  intake_decisions: { maintained: auto, confirm_auto_resolutions: batched, fingerprint_scope: [ticket_type, module, category] }
```

Each section's `maintained: auto | manual` governs whether detection may touch
it. Schema validation rejects unknown keys at any `process.*` path.

## New Decision categories

Five bookend categories were added to `DECISION_CATEGORIES` in
[`src/planning/decision-packet.ts`](../../../src/planning/decision-packet.ts):

| Category | Used by |
| --- | --- |
| `intake.requirement` | A choice the refined ticket needs pinned. |
| `intake.confirm_auto_resolution` | The batched "we resolved N from priors, accept or override" prompt. |
| `intake.write_back` | Source-ticket write-back confirmation. |
| `delivery.open_pr` | The PR creation gate (yes / draft / no). |
| `delivery.ci_red` | A red CI build where `on_red` needs a human call. |

All ride the existing `pending → resolved` lifecycle, audit log, and TTL
machinery. `DECISION_CATEGORY_DEFAULTS` lists their `create_new` flag,
`reversibility`, and `ttl_days`.

## Related

- [Provider-Agnostic Delivery Workflow](../delivery-workflow/index/summary.md)
- [Decision Pause Contract managed-doc architecture](../decision-pause-contract/managed-doc-architecture.md)
- [`src/pipeline/feature-development-policy.ts`](../../../src/pipeline/feature-development-policy.ts)
- [`src/pipeline/delivery-policy.ts`](../../../src/pipeline/delivery-policy.ts)
- [`src/providers/`](../../../src/providers/)
- [`src/planning/intake-prior-resolver.ts`](../../../src/planning/intake-prior-resolver.ts)
- [`src/planning/batched-confirm.ts`](../../../src/planning/batched-confirm.ts)
- [`src/delivery/`](../../../src/delivery/)
