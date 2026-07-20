# Feature Development Workflow

## Purpose

Define the exact stages to follow whenever the user asks to create or change code, so the AI runs the full structured feature-development workflow instead of editing ad hoc. This is the same kind of workflow as `pentest` or `design-test`: it has stages, and every stage is mandatory.

## Trigger

Run this workflow whenever the user's request is an **intent to create or change code**, however it is phrased. This is triggered by intent, not by a fixed keyword list. Examples that all trigger it:

- "build X", "make X", "create X", "add X", "implement X", "wire up X" <!-- @rule RL-7c89 -->
- "fix X", "change X", "update X", "refactor X", "rework X", "rename X" <!-- @rule RL-7a94 -->
- "let's do X", "can you do X", "get X working", and any equivalent <!-- @rule RL-50f4 -->

If the request would result in an `Edit`, `Write`, or new file in the codebase, it is a code change and this workflow applies.

Do **not** improvise. Do **not** jump straight to editing code. Always run the stages below **in order**, and run **every** stage. Skipping a stage (no spec, no review, no checks, no doc-sync) invalidates the workflow and the change cannot be trusted as done.

## Authoritative source

The canonical, project-customizable definition of these stages lives in `docs/instructions/workflows/feature-development.yaml` (and delivery conventions in `docs/instructions/workflows/delivery-policy.yaml`). Both use `merge_mode: append`, so a project's overrides win. Load those files and follow them. The stages below are the mandatory sequence; the YAML carries the authoritative per-stage `strictness`, `escalation`, and gate flags. Where the YAML and this rule differ, the YAML wins.

Honor every stage's escalation flag through the Decision Pause Contract:

- `stop` → write a Decision Packet and wait for the user before continuing. <!-- @rule RL-113d -->
- `ask` → ask the user and wait for the answer. <!-- @rule RL-0cb1 -->
- `warn` → surface a note and continue. <!-- @rule RL-3caf -->

## Announce each stage

Make the workflow visible. As you enter each stage, tell the developer where you are, in the paqad voice defined by the narration contract (loaded with the framework). Emit one compact `▸ paqad` status line as you begin each stage, in plain language. Translate the stage into something a person understands; never print the internal stage key.

This is required, for two reasons: the developer sees the framework working for them, and the running commentary is the live signal that the workflow is actually being followed, stage by stage.

The wording is yours; the cadence is fixed (one line as you start each stage, never a paragraph, never on every action inside a stage). For example:

- planning → `▸ paqad · planning this out, checking which module it touches` <!-- @rule RL-65d6 -->
- specification → `▸ paqad · writing the spec before any code` <!-- @rule RL-04cc -->
- development → `▸ paqad · building it to the spec` <!-- @rule RL-a3a4 -->
- review → `▸ paqad · reviewing the change for regressions` <!-- @rule RL-e055 -->
- checks → `▸ paqad · running the gates: format, tests, build, rules` <!-- @rule RL-d8ea -->
- documentation_sync → `▸ paqad · syncing the docs this change touched` <!-- @rule RL-f91e -->
- delivery → `▸ paqad · delivering per the branch and PR conventions` <!-- @rule RL-c799 -->

Follow the narration contract's plain-English translations and glyph meanings. When a stage hits a `stop` or `ask` escalation, surface it through the Decision Pause Contract (a pause is its own narration moment), not a status line.

## Workflow Stages

Run these in order. Depth scales with the change (a trivial change has a one-line spec and a quick review), but no stage is omitted. Announce each stage as you enter it (see "Announce each stage" above).

### Stage 0 — ticket_intake (optional bookend)

- Runs only when the request references a tracker ticket (Jira `PROJ-123`, GitHub `#123`). It is an **optional bookend** — a change that did not start from a ticket skips it and is never blocked. <!-- @rule RL-264a -->
- **Fetch the real ticket deterministically**, don't guess from the id: `npx paqad-ai intake fetch <ref>` pulls the actual title, body, acceptance notes, and labels (GitHub via `gh`; Jira via the Atlassian MCP in-session). Ground the specification in that real text so each acceptance criterion traces back to the ticket. <!-- @rule RL-6fd0 -->
- Detect implicit choices the ticket leaves open and resolve them priors-first, then rules-second, then ask. Auto-resolved decisions must be surfaced for confirmation per `process.intake_decisions.confirm_auto_resolutions`; never bypass the user silently. <!-- @rule RL-496d -->
- Requirement confirmation is a genuine user decision — route it through the Decision Pause Contract (`intake.requirement`), never auto-accept. <!-- @rule RL-33a4 -->
- Escalations: `missing_ticket: warn`, `unresolved_decisions: stop`. <!-- @rule RL-1091 -->

### Stage 1 — planning

- Load the canonical module and instruction docs for the area before planning (`docs/modules/**`, `docs/instructions/**`). <!-- @rule RL-48b3 -->
- Run the **attribution gate**: identify which module(s) the change belongs to (the `module-attribution-extractor` then `module-attribution-inferencer` skills). If attribution is unresolved, escalate `attribution_pending: stop` via a Decision Packet — never guess silently. <!-- @rule RL-7919 -->
- Produce the implementation sequence scoped to the request and the current repository state. <!-- @rule RL-2f27 -->
- Compile the plan into the feature bundle with `npx paqad-ai plan compile <plan-template.json>`: it writes the rigid `plan.json` into the active feature's bundle (`.paqad/ledger/feature-evidence/<change>/plan.json`) — the durable planning artifact. **Always include the change's `title` (with its ticket ref, e.g. `fix(#403): …`) in the plan template**: a change opened by a bare `paqad:stage planning start` is minted as the generic `change-<ULID>`, and the titled compile is what renames the bundle to its descriptive `[<issue>-]<slug>-<ULID>` name (issue #403). End the planning stage against **that** file (`paqad:stage planning end -- <path-to-plan.json>`, or `npx paqad-ai stage end planning --artifact <path-to-plan.json>`) — the compile prints the (possibly renamed) path to use. Do **not** hand-write the plan to `.paqad/plans/*` or any other location: only the bundle's `plan.json` is the artifact, and a stage-end pointing anywhere else records inconclusive. <!-- @rule RL-73a4 -->
- Before compiling the plan, check the Existing surface section and/or run `npx paqad-ai index query <name>`. The plan must record what you checked (`consulted`), what you will reuse (`reusing`), and must justify anything new (`new_constructs`). A plan template without a `reuse` section does not compile, so a change can never quietly rebuild something the project already has. First-party claims are checked against the code-knowledge index (an unknown symbol fails with the nearest match); when a framework is detected, a new construct must also record the framework check, and a framework-native claim must name the installed version. A missing index or stack snapshot downgrades the check to a warning rather than blocking.
- The filled plan template looks like this — `summary` is required, and `reuse` is required:

  ```jsonc
  {
    "title": "feat(#357): short change title with its ticket ref",
    "summary": "What this change does, in one or two sentences.",
    "steps": [{ "id": "s1", "description": "wire the router", "module": "pipeline" }],
    "modules_touched": ["pipeline"],
    "decisions": ["D-01J…"], // resolved decision-packet ids this plan depends on
    "risks": [{ "description": "…", "mitigation": "…" }],
    "reuse": {
      "consulted": [
        // ≥1 entry — what you actually checked
        { "source": "index-query", "query": "date formatting", "hits": 2 },
      ],
      "reusing": [
        // may be empty
        { "symbol": "formatIsoDate", "file": "src/utils/dates.ts", "how": "call as-is" },
      ],
      "new_constructs": [
        // every NEW exported construct, justified
        {
          "name": "formatRelativeDate",
          "justification": "no existing helper handles the relative form; nearest is formatIsoDate (checked)",
        },
      ],
    },
  }
  ```

  `consulted[].source` is one of `existing-surface`, `index-query`, `reuse-catalog`, `module-doc`, `grep`, `framework-api`, `framework-docs`. A framework-native reuse claim adds `package` and the resolved `version` (for example `{ "symbol": "Str::of", "package": "laravel/framework", "version": "10.48.2", "how": "use Str::of()->slug() instead of a hand-rolled slugger" }`); when a framework is detected, a new construct adds `framework_checked: { package, nearest, verdict }` with `verdict` one of `reuse`, `extend`, `insufficient`, `absent`.

- Never write anything into a feature bundle directory (`.paqad/ledger/feature-evidence/<change>/`). It holds only its rigid, script-written artifacts (`plan.json`, `specification.json`, `review.json`, the ledgers, `delivery.json`, `receipt.json`, `ai-bom.json`) plus the generated `report.html`. Author your plan template, spec markdown, and review template anywhere else — the compile/freeze/record verbs put the rigid record in the bundle for you and delete the transient input. A stage-end artifact pointing at a non-rigid file inside a bundle directory is rejected. <!-- @rule RL-4022 -->
- Escalations: `attribution_pending: stop`, `rule_scripts_stale: ask`, missing docs/design-system: `warn`. <!-- @rule RL-4da7 -->

### Stage 2 — specification

- Write or refine the feature specification **before** implementation. The spec carries the behavior, acceptance criteria (AC-n, given/when/then, proof type), and confirmed invariants. <!-- @rule RL-e575 -->
- On graduated/full lanes the spec must be **frozen and signed off** before development (`require_spec_signoff`, framework-owned, cannot be downgraded by a project override). A mid-build goal change or a work-vs-spec contradiction escalates via the Decision Pause Contract (`spec.change` / `spec.contradiction`). <!-- @rule RL-0ca2 -->
- Freeze it with `npx paqad-ai spec freeze <spec-file> --signed-off-by <name> --confirm-invariants`: it evaluates the freeze blockers and, on a clean spec, writes the frozen `specification.json` into the active feature's bundle (`.paqad/ledger/feature-evidence/<change>/specification.json`) — the durable record later stages check against. It refuses to freeze over open questions, missing acceptance criteria, or unconfirmed invariants. End the specification stage against **that** `specification.json` (`paqad:stage specification end -- <path-to-specification.json>`, or `npx paqad-ai stage end specification --artifact <path-to-specification.json>`). Do **not** hand-write the spec to `.paqad/specs/*` or any other location as the durable artifact: only the bundle's `specification.json` is the artifact, and a stage-end pointing anywhere else records inconclusive. <!-- @rule RL-9321 -->
- Escalations: `missing_spec: stop`, `missing_spec_signoff: stop`. <!-- @rule RL-c174 -->

### Stage 3 — development

- Implement only the requested behavior. Do not refactor, reformat, or rename unrelated code in the same change. <!-- @rule RL-e1aa -->
- If scope grows beyond the spec, escalate `scope_expansion: ask` before expanding. <!-- @rule RL-f03e -->

### Stage 4 — review

- Review the change against correctness, regressions, and rollback risk before treating it as complete. <!-- @rule RL-2e65 -->
- Record the review with `npx paqad-ai review record <review-template.json>`: it writes the rigid `review.json` into the active feature's bundle (`.paqad/ledger/feature-evidence/<change>/review.json`) from a filled template (`{ summary, verdict, findings, checked, rollback }`, where `verdict` is one of `safe-to-merge`, `needs-attention`, `inconclusive`). End the review stage against **that** file (`paqad:stage review end -- <path-to-review.json>`, or `npx paqad-ai stage end review --artifact <path-to-review.json>`). Do **not** hand-write review notes to a `.md` or any other location as the durable artifact: only the bundle's `review.json` is the artifact, and a stage-end pointing anywhere else records inconclusive. <!-- @rule RL-4021 -->
- Blocking findings escalate `review_findings: stop`. <!-- @rule RL-e522d -->

### Stage 5 — checks

- Run the project command checks: `format`, `test`, `build` (use the project profile's mapped commands). `block_on_failure` is true — a failing gate stops forward progress; fix it before continuing. Run them deterministically with `npx paqad-ai checks run`: it executes the mapped commands, exits non-zero on any red, and persists a structured report the completion gate reads so success is proven, not assumed. <!-- @rule RL-0e8d -->
- Verify test coverage meets the project bar. <!-- @rule RL-18bd -->
- Run the `rule_compliance` gate (registered rule scripts, `mode: strict`, scope `changed-files`); deterministic findings escalate `stop`. The gate needs `rule-script-map.yml`, generated at onboarding and refreshable with `npx paqad-ai rules compile`; without it enforcement fast-skips. Strictness is the stricter of the tracked `configs/.config.*` `rule_compliance` value and this workflow's `checks.rule_compliance.mode` — both are real inputs (issue #319). <!-- @rule RL-c543 -->
- Run the `module-health` rollup; rollup-blocked metrics are informational `warn`. <!-- @rule RL-4789 -->

### Stage 6 — documentation_sync

- Sync the canonical docs affected by the change after verification passes (module docs, registries, design-system contract as the diff requires). <!-- @rule RL-0b14 -->
- Stale or missing doc updates escalate `stop`. <!-- @rule RL-ede8 -->

## Delivery

When the change is delivered, follow `docs/instructions/workflows/delivery-policy.yaml`: branch naming, conventional-commit format with the ticket in scope, PR title/body and ticket linkage, and the CI gate (`wait_for_green`; red CI is `on_red: stop`).

## Rules

- **Never skip a stage.** Every stage runs, in order, on every code change. A trivial change runs the stages lightly; it does not skip them. <!-- @rule RL-f1af -->
- The mandatory safety stages (specification sign-off, checks, documentation_sync) are framework-owned and cannot be downgraded by a project override. <!-- @rule RL-2a31 -->
- Consult the workflow to decide the **lane** (how deep each stage goes), never to **omit** a stage. <!-- @rule RL-e8aa -->
- Point at the project's copy of the workflow files and follow them; never inline a frozen copy of the steps that ignores project overrides. <!-- @rule RL-2684 -->
- Honor every escalation through the Decision Pause Contract — never resolve a `stop` silently. <!-- @rule RL-791a -->
