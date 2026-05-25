# feature-development: `ticket_intake` + `delivery` bookends with priors-first decision elicitation, driven by project-owned conventions

## TL;DR

Close the two open ends of the feature-development workflow — ticket intake on the front, PR delivery on the back — and make **decision elicitation a first-class part of intake** instead of an afterthought. Everything is built on primitives the codebase already exposes; the only genuinely new runtime logic is (a) fingerprint _matching_ (today fingerprints are computed but never matched), (b) a batched question UI primitive, (c) git/remote glue for delivery, and (d) extending `STAGE_ORDER` plus the policy schema for two new stages.

---

## Pre-flight (before any implementation starts)

This work touches `STAGE_ORDER`, schemas, and the decision-pause runtime — all areas where `main` moves fast. Before branching off:

```bash
git fetch origin main
git checkout main
git pull --ff-only origin main
```

Then branch from the freshly-updated `main`. If `git pull --ff-only` refuses (diverged local main), resolve that explicitly — do **not** force-reset. Re-run `pnpm install` if `pnpm-lock.yaml` changed, and re-run the policy-fixture tests (`tests/unit/pipeline/feature-development-policy.test.ts`) as a sanity check before adding new stages — they're the canonical proof that the override mechanism still works.

This applies to every PR slice of this ticket, not just the first one.

---

## Current state — verified against `main` @ 8fbde52

A deep read of the repo grounds this proposal in what already works vs. what is genuinely new. **Don't trust the ticket's claims about existing state unless they're in this section** — the original draft conflated "exists" with "computed but unused."

### What already works (reuse, don't rebuild)

| Primitive                    | File / path                                                                            | Notes                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature-development stages   | `src/pipeline/feature-development-policy.ts:25-32` — `STAGE_ORDER`                     | Stages **hard-coded**: `planning → specification → development → review → checks → documentation_sync`. Adding new stages = source change, not YAML override.                                                                                                                                            |
| Per-stage override semantics | `src/validators/schemas/feature-development-policy.schema.json` + `stagePolicy` $defs  | Per-stage keys: `read`, `instructions`, `required_inputs`, `strictness`, `escalation`, `artifacts`, plus `checks` on the checks stage. `merge_mode` enum has exactly one value: `"append"`. `additionalProperties: false` everywhere.                                                                    |
| Decision packet schema       | `src/planning/decision-packet.ts:63-82`                                                | Fields: `decision_id`, `fingerprint`, `category`, `question`, `context`, `options[]`, `recommendation`, `recommendation_reason`, `confidence`, `requested_by`, `task_session_id`, `linked_requirements`, `linked_slice_id`, `created_at`, `status`, `human_response`, `ttl_until`, `invalidation_watch`. |
| Decision human response      | `src/planning/decision-packet.ts:53-61`                                                | `chosen_option_key`, `intent`, `explanation_rounds_used`, `responded_at`, `responded_by`, `carry_over_scope`, `note`. (The original ticket's "chosen" maps to `chosen_option_key`; "rationale" maps to `note`.)                                                                                          |
| Fingerprint **computation**  | `src/planning/decision-fingerprint.ts:46-55`                                           | SHA256 of `category :: normalizedQuestion :: sortedOptionKeys :: repoStateSignature`. Overlap scorer at L73-89.                                                                                                                                                                                          |
| Decision index               | `.paqad/decisions/index.json`                                                          | Contains `{ fingerprints: {}, decisions: {} }`. Fingerprints map currently **empty**.                                                                                                                                                                                                                    |
| Audit log                    | `src/planning/decision-audit.ts:23-34`                                                 | Event types include `decision-reused` — implying the design anticipated reuse but it's not wired.                                                                                                                                                                                                        |
| MCP servers schema           | `src/validators/schemas/project-profile.schema.json:187-205`                           | `mcp.servers[] = { name, enabled, config }`. **No `kind`/provider enum**.                                                                                                                                                                                                                                |
| Skills (runtime, not src)    | `runtime/base/skills/{requirement-enrichment,scope-check,cross-module-impact-scanner}` | All three exist as runtime skills with SKILL.md, agents/, scripts/, assets/.                                                                                                                                                                                                                             |
| Agents                       | `runtime/base/agents/{requirement-analyst,story-designer}.md`                          | Both exist.                                                                                                                                                                                                                                                                                              |
| Schema validation            | `src/validators/validator.ts`                                                          | `SchemaValidator` enforces JSON Schema with `additionalProperties: false`. The "reject unknown keys" acceptance criterion is **already the house convention** — we get it for free for any new schema.                                                                                                   |
| Override fixture             | `tests/unit/pipeline/feature-development-policy.test.ts:25-61`                         | Canonical proof of `merge_mode: append` behavior — basis for our new tests.                                                                                                                                                                                                                              |

### What does **not** exist (genuinely new work)

| Gap                                                                        | Evidence                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fingerprint matching / prior-reuse logic**                               | Zero call sites for the fingerprint outside computation + storage. `decision-reused` event type defined but never emitted.                                                                                                                                              |
| **Any ticket-provider / Jira abstraction**                                 | No `kind` field in MCP schema; no provider-shaped module under src/ or docs/modules/.                                                                                                                                                                                   |
| **Any git / branch / commit / PR / push code in src/**                     | Grep returns nothing for `git push`, `gh pr`, branch/commit primitives. Delivery is 100% ad-hoc today.                                                                                                                                                                  |
| **`.paqad/templates/` directory**                                          | Does not exist. `runtime/templates/` has handlebars templates for specs/handoffs, **not** for PR bodies or commits.                                                                                                                                                     |
| **Batched question UI**                                                    | `src/cli/ui/decision-screen.ts` and the claude-adapter (`src/adapters/claude/claude-adapter.ts`) surface **one** packet at a time. The CLAUDE.md decision contract presents packets "one at a time in numeric order." Batched confirm-N-resolutions is a new primitive. |
| **Post-`documentation_sync` hook lifecycle**                               | No generic per-stage pre/post hook — only named hooks (`pre-commit-check.sh`, `agent-entry-gate.sh`, …). Adding `delivery` as a real stage in `STAGE_ORDER` is the right architectural fit; do **not** invent a hook lifecycle.                                         |
| **`docs/modules/scope-check`, `docs/modules/cross-module-impact-scanner`** | Skills exist; doc modules don't. Either add them or stop cross-referencing them.                                                                                                                                                                                        |

### Corrections to the original ticket

- "Resolved packets carry `chosen`, `rationale`" — the field names are **`human_response.chosen_option_key`** and **`human_response.note`**. The ticket's shorthand has leaked into the wider spec; tighten it.
- "Priors are tracked in `index.json` (with `fingerprints`)" — partially true: the field exists, but **no code reads it for reuse**. Calling this "tracked" overstates reality.
- Stage list is **six** stages (`planning → specification → development → review → checks → documentation_sync`), not seven.

---

## Why this matters — today's AI failure modes that intake/delivery target

Drawn from current public reports on agent failure modes ([Stack Overflow, Jan 2026](https://stackoverflow.blog/2026/01/28/are-bugs-and-incidents-inevitable-with-ai-coding-agents/); [vectara/awesome-agent-failures](https://github.com/vectara/awesome-agent-failures); [MIT Sloan, 2026](https://mitsloan.mit.edu/ideas-made-to-matter/action-items-ai-decision-makers-2026); [Bitmovin](https://bitmovin.com/blog/ai-developer-workflows-jira-to-pull-request/); [deepsense.ai](https://deepsense.ai/blog/from-jira-to-pr-claude-powered-ai-agents-that-code-test-and-review-for-you/)):

1. **Error compounding.** Small early hallucinations bake into long-horizon agent runs. Intake's "ground in rules/stack/design-system + prior decisions before any code is written" cuts the blast radius at the front.
2. **Tool-restraint failure.** Agents invent answers rather than escalating. Decision Pause already encodes "escalate on ambiguity"; this ticket extends that discipline _backwards_ into refinement, which is where most invention happens today.
3. **Shared-memory contamination.** One hallucinated entry pollutes every downstream agent that queries it. Priors-first reuse must be **citation-bound** (every auto-resolution names the prior `D-{N}` and shows it to the user) so a bad prior is visible and reversible, not silently propagated.
4. **Incomplete tickets slowing teams.** External research consistently flags poorly-structured tickets as the #1 cause of agent-driven rework. `ticket_intake` is the structural answer.
5. **Knowledge silos in native Jira AI.** Native Jira AI sees Jira; our intake stage sees Jira **plus** repo rules/stack/design-system/decisions/modules — the layered knowledge story is the differentiator.

---

## Proposal

Two **framework-owned, project-overridable** stages bookending the existing six, plus a new `conventions:` customization block. `ticket_intake` runs a priors-first decision-elicitation sub-loop. Decision Pause Contract is extended — not replaced.

### Stage A — `ticket_intake` (before `planning`)

**Trigger.** Project has an MCP server flagged as a ticket provider (see §"MCP `kind` extension" below). Accepts either an explicit ticket ref or a natural-language prompt.

**Sub-stages:**

1. **Fetch** — pull the ticket via the configured ticket-provider MCP.
2. **Ground** — load `docs/instructions/{rules,stack,design-system}`, implicated module docs (via the existing `scope-check` + `cross-module-impact-scanner` skills under `runtime/base/skills/`), and the prior decision corpus (`.paqad/decisions/resolved/` + `index.json` fingerprints).
3. **Refine** — invoke `requirement-analyst`, `story-designer`, `requirement-enrichment` skills (already in `runtime/base/`): tighten description, derive acceptance criteria, mark in/out of scope, list implicated modules.
4. **Elicit decisions** — for every choice the refined ticket implies but does not pin down, run this loop (the heart of the proposal):
   - **Try to auto-answer.** Sources, in order:
     1. **Prior resolved decisions** — match by fingerprint via `index.json`. If a prior `chosen_option_key` answers the same question under the same context fingerprint, reuse it; write a new packet with `human_response.chosen_option_key` pre-filled and `human_response.note` citing the prior `D-{N}`. **Emit a `decision-reused` audit event** (event type already defined; this is its first emitter).
     2. **Repo rules / stack / design-system** — if an explicit rule answers the question, same treatment: pre-fill, cite the source path in `note`.
     3. **Ticket itself** — if the ticket body or AC already pin the answer, capture as a confirmed packet.
   - **Otherwise — ask.** Write a `pending` packet with the agent's best guess in `recommendation` and a tight (≤4) options set. Surface via the existing question UI; workflow stops until resolved.
   - **Either path produces a resolved packet.** Auto-answered packets are surfaced for confirmation per `confirm_auto_resolutions` (default: batched single prompt showing all N auto-resolutions with accept/override). **This is the new batched primitive** (see §"Adapter contract change").
5. **(Optional) Write-back** — propose updating the ticket with the refined description + AC + linked decisions. Gated by `conventions.ticket.write_back: never | ask | always`. Use **explicit user confirmation**, not silent updates — write-backs to external systems are shared-state and reputation-sensitive.

**Artifacts:** refined ticket (becomes `active request` for `planning`), resolved decision packets (with citations back to priors when applicable).

**Strictness:** `require_ticket` (configurable) → stop if no ticket resolves. Any `pending` packet blocks (matches existing contract).

### Stage B — `delivery` (after `documentation_sync`)

1. Decision Pause asks: open a PR? (`yes | draft | no`).
2. On `yes`/`draft`:
   - Create branch using `conventions.branch.template`, push, open PR, link back to ticket if intake produced one, transition ticket per `conventions.pr.transition_on_open`.
   - Host inferred from git remote (GitHub today; abstracted so GitLab/Bitbucket are additive later, **not** required now).
3. **MCP / git / remote failures `stop` with remediation** — no silent local-only fallback. Failures here are recoverable but require human judgement (auth, conflicts, branch protection).

### `conventions:` block

Framework defaults, project overrides win, schema validated with `additionalProperties: false` (free via existing `SchemaValidator`):

```yaml
conventions:
  ticket:
    provider: jira # MCP kind; future: linear, github-issues
    server: '' # name of the MCP server entry to use
    require_ticket: false
    write_back: ask # never | ask | always
  intake_decisions:
    auto_resolve_from_priors: true
    auto_resolve_from_rules: true
    confirm_auto_resolutions: batched # always | batched | never
    max_options_per_packet: 4
    fingerprint_scope: [ticket_type, module, category]
  branch:
    template: '{type}/{ticket}-{title_slug}'
    type_map: { Story: feat, Bug: fix, Task: chore, default: feat }
    slug_max_length: 50
    base: main
  commit:
    template: "{type}({scope}): {summary}\n\nRefs: {ticket}"
    sign_off: false
  pr:
    title_template: '{type}({scope}): {summary} [{ticket}]'
    body_template_path: .paqad/templates/pr-body.md
    base: main
    draft: false
    reviewers: []
    labels: []
    link_ticket: true
    transition_on_open: 'In Review' # or "" for no transition
```

### Decision Pause extensions

New categories appended to the `DecisionCategory` enum in `src/planning/decision-packet.ts`:

- `intake.requirement` — a choice the refined ticket needs pinned.
- `intake.confirm_auto_resolution` — the batched "we resolved N from priors, accept or override" prompt.
- `intake.write_back` — ticket-system write-back confirmation.
- `delivery.open_pr` — PR creation gate.

All follow the existing `pending → resolved` lifecycle and write to `audit.jsonl`. The `decision-reused` event type (already defined, never emitted) gets its first emitter from intake's priors-first path.

### MCP `kind` extension

Today `mcp.servers[]` is `{ name, enabled, config }`. Add an optional `kind` discriminator (`"jira"` initially), validated as a string enum. Existing servers without `kind` continue to validate — backwards-compatible. Intake reads the first enabled server whose `kind` matches `conventions.ticket.provider`, with `conventions.ticket.server` as an explicit override.

### Adapter contract change — batched question UI

Today the question UI handles one packet at a time. Add a **batched-confirm** primitive: present N already-resolved packets in a single screen with per-row accept/override (or accept-all). Required only for `intake.confirm_auto_resolution`; single-packet flow remains the default for everything else.

For the claude-code adapter, this means extending `src/adapters/claude/claude-adapter.ts` + the decision-screen renderer (`src/cli/ui/decision-screen.ts`). The CLAUDE.md decision-pause contract — "ask one at a time in numeric order" — needs an explicit carve-out for the batched-confirm category.

---

## Architectural decisions worth flagging up front (resolve before scoping)

The original ticket presented these as settled; they aren't. Each is a Decision Packet candidate before implementation begins:

1. **Stage extension mechanism.** `STAGE_ORDER` is currently a hard-coded array. Options: (A) hard-code two new stages and call it done; (B) introduce an "extension stages" registry so future bookends don't need source changes. (A) is faster, (B) compounds. _Recommendation: A — premature abstraction otherwise._
2. **Priors-reuse risk profile.** Auto-resolving from priors is powerful but propagates bad decisions. Options: (A) `confirm_auto_resolutions: always` as default (safe, more friction); (B) `batched` as default (balanced, the original ticket's choice); (C) `never` (priors as suggestions only). _Recommendation: B with prominent docs about the trade-off._
3. **PR host abstraction.** Options: (A) GitHub-only now, GitLab/Bitbucket later via discriminated union; (B) abstract from day one. _Recommendation: A — concrete first._
4. **Ticket write-back default.** `ask` vs. `never`. _Recommendation: `ask` — visibility beats silence, but no silent edits to shared systems._
5. **Doc-module status for `scope-check` / `cross-module-impact-scanner`.** Either promote the runtime skills to `docs/modules/` entries (parity with other skills referenced in workflow docs) or stop cross-referencing them as modules.

---

## Out of scope

- Non-Jira providers (Linear, GitHub Issues) — additive via further `kind` enum values.
- Epic / multi-ticket decomposition — stays in `specification` under `story-designer`.
- Auto-merging PRs — explicit non-goal.
- A generic per-stage pre/post hook lifecycle — `ticket_intake` and `delivery` are real stages, not hook plugins.

---

## Acceptance criteria

### Framework wiring

- [ ] `STAGE_ORDER` in `src/pipeline/feature-development-policy.ts` extended to `[ticket_intake, planning, specification, development, review, checks, documentation_sync, delivery]`.
- [ ] `src/validators/schemas/feature-development-policy.schema.json` updated with `ticket_intake` and `delivery` stage definitions; `additionalProperties: false` still rejects typos.
- [ ] New top-level `conventions:` block defined in a schema (project-profile or workflow — pick one and document the choice) with **all** keys above, defaults populated, `additionalProperties: false`, unknown-key errors cite the offending JSON path.
- [ ] Onboarded projects pick both stages up with zero YAML edits.

### Intake

- [ ] Projects with a ticket-provider MCP can start from a ticket ref _or_ natural-language prompt; produce a refined-ticket artifact grounded in repo rules/stack/design-system + prior decisions.
- [ ] Refinement detects implicit decisions and resolves them via priors-first → rules-second → ask-last; every decision becomes a resolved packet citing its source in `human_response.note`.
- [ ] Auto-resolved decisions surfaced per `confirm_auto_resolutions` (default batched).
- [ ] `index.json.fingerprints` is read for matching and updated for new packets.
- [ ] `decision-reused` audit event is emitted at every fingerprint-hit reuse (first emitter for this event type).
- [ ] Any `pending` packet from intake blocks the workflow.
- [ ] Ticket write-back gated by `conventions.ticket.write_back`; never silent.

### Delivery

- [ ] After `documentation_sync`, `delivery` asks `yes | draft | no`.
- [ ] Branch / commit / PR text rendered from `conventions:` templates; defaults work zero-config; project overrides win.
- [ ] Ticket-linked PRs link back and transition per `pr.transition_on_open` (empty string = no transition).
- [ ] MCP / git / remote failures stop with actionable remediation text; no silent local-only fallback.

### Cross-cutting

- [ ] Decision categories `intake.requirement`, `intake.confirm_auto_resolution`, `intake.write_back`, `delivery.open_pr` added to `DecisionCategory` and exercised by tests.
- [ ] MCP schema gains optional `kind` field; existing zero-`kind` servers still validate.
- [ ] Batched-confirm question primitive added to claude-code adapter; existing single-packet flow unchanged for other categories.
- [ ] CLAUDE.md decision-pause contract amended with the batched-confirm carve-out.
- [ ] Module docs cover both stages, the elicitation sub-loop, the new categories, and `conventions:`; cross-refs added in `docs/modules/decision-pause-contract/` (priors-reuse semantics) and `docs/modules/mcp-config/` (ticket-provider `kind`).
- [ ] Doc-module status for `scope-check` and `cross-module-impact-scanner` resolved (created or de-referenced — decided up front).

### Testing

- [ ] Unit tests mirror `tests/unit/pipeline/feature-development-policy.test.ts` override fixture pattern for the two new stages.
- [ ] Priors-reuse path tested with at least one prior `D-{N}` and one fingerprint miss.
- [ ] Batched-confirm UI snapshot test.
- [ ] Git/PR delivery path mocked at the boundary (no live remote in CI).

---

## Risks & mitigations

| Risk                                                      | Mitigation                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Priors-reuse propagates a bad past decision silently.     | Default `confirm_auto_resolutions: batched`; every auto-resolution cites its source; user can override individually.     |
| Stage hard-coding makes future bookends painful.          | Acknowledged; defer the registry abstraction until a third stage actually needs adding.                                  |
| Jira write-back updates the wrong ticket.                 | `write_back: ask` default; explicit per-packet confirmation; never silent.                                               |
| MCP failures leave the workflow in a half-resolved state. | All external-system steps `stop` with remediation; no partial-success branches.                                          |
| Schema migrations break existing projects.                | All new keys optional with defaults; `kind` on MCP optional; existing fixtures validate unchanged. Add a migration test. |

---

## Where things live (summary)

- **Framework runtime (npm package, `src/`)** — `STAGE_ORDER` extension, new schemas, fingerprint matcher, priors-reuse audit emission, ticket-provider MCP resolver, git/PR glue, batched-confirm renderer.
- **Framework runtime (`runtime/`)** — reuse existing `requirement-analyst`, `story-designer`, `requirement-enrichment`, `scope-check`, `cross-module-impact-scanner` skills and agents. New `runtime/templates/pr-body.md.hbs` if we want a default; otherwise project-only.
- **Onboarded project** — optional overrides in `feature-development.yaml`, an MCP server entry with `kind: jira`, optional `.paqad/templates/pr-body.md`.
- **Docs** — `docs/modules/feature-development-workflow/` gains feature pages for both stages and the elicitation sub-loop; `docs/modules/decision-pause-contract/` gains priors-reuse semantics; `docs/modules/mcp-config/` documents `kind`.

---

**Sources for the "today's AI problems" framing:**

- [Are bugs and incidents inevitable with AI coding agents? — Stack Overflow, Jan 2026](https://stackoverflow.blog/2026/01/28/are-bugs-and-incidents-inevitable-with-ai-coding-agents/)
- [vectara/awesome-agent-failures](https://github.com/vectara/awesome-agent-failures)
- [Action items for AI decision makers in 2026 — MIT Sloan](https://mitsloan.mit.edu/ideas-made-to-matter/action-items-ai-decision-makers-2026)
- [AI Developer Workflows: From Jira Ticket to PR — Bitmovin](https://bitmovin.com/blog/ai-developer-workflows-jira-to-pull-request/)
- [From Jira to PR — deepsense.ai](https://deepsense.ai/blog/from-jira-to-pr-claude-powered-ai-agents-that-code-test-and-review-for-you/)
