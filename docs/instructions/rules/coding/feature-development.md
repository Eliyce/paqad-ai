# Feature Development Workflow

## Purpose

Define the exact stages to follow whenever the user asks to create or change code, so the AI runs the full structured feature-development workflow instead of editing ad hoc. This is the same kind of workflow as `pentest` or `design-test`: it has stages, and every stage is mandatory.

## Trigger

Run this workflow whenever the user's request is an **intent to create or change code**, however it is phrased. This is triggered by intent, not by a fixed keyword list. Examples that all trigger it:

- "build X", "make X", "create X", "add X", "implement X", "wire up X"
- "fix X", "change X", "update X", "refactor X", "rework X", "rename X"
- "let's do X", "can you do X", "get X working", and any equivalent

If the request would result in an `Edit`, `Write`, or new file in the codebase, it is a code change and this workflow applies.

Do **not** improvise. Do **not** jump straight to editing code. Always run the stages below **in order**, and run **every** stage. Skipping a stage (no spec, no review, no checks, no doc-sync) invalidates the workflow and the change cannot be trusted as done.

## Authoritative source

The canonical, project-customizable definition of these stages lives in `docs/instructions/workflows/feature-development.yaml` (and delivery conventions in `docs/instructions/workflows/delivery-policy.yaml`). Both use `merge_mode: append`, so a project's overrides win. Load those files and follow them. The stages below are the mandatory sequence; the YAML carries the authoritative per-stage `strictness`, `escalation`, and gate flags. Where the YAML and this rule differ, the YAML wins.

Honor every stage's escalation flag through the Decision Pause Contract:

- `stop` → write a Decision Packet and wait for the user before continuing.
- `ask` → ask the user and wait for the answer.
- `warn` → surface a note and continue.

## Workflow Stages

Run these in order. Depth scales with the change (a trivial change has a one-line spec and a quick review), but no stage is omitted.

### Stage 1 — planning

- Load the canonical module and instruction docs for the area before planning (`docs/modules/**`, `docs/instructions/**`).
- Run the **attribution gate**: identify which module(s) the change belongs to (the `module-attribution-extractor` then `module-attribution-inferencer` skills). If attribution is unresolved, escalate `attribution_pending: stop` via a Decision Packet — never guess silently.
- Produce the implementation sequence scoped to the request and the current repository state.
- Escalations: `attribution_pending: stop`, `rule_scripts_stale: ask`, missing docs/design-system: `warn`.

### Stage 2 — specification

- Write or refine the feature specification **before** implementation. The spec carries the behavior, acceptance criteria (AC-n, given/when/then, proof type), and confirmed invariants.
- On graduated/full lanes the spec must be **frozen and signed off** before development (`require_spec_signoff`, framework-owned, cannot be downgraded by a project override). A mid-build goal change or a work-vs-spec contradiction escalates via the Decision Pause Contract (`spec.change` / `spec.contradiction`).
- Escalations: `missing_spec: stop`, `missing_spec_signoff: stop`.

### Stage 3 — development

- Implement only the requested behavior. Do not refactor, reformat, or rename unrelated code in the same change.
- If scope grows beyond the spec, escalate `scope_expansion: ask` before expanding.

### Stage 4 — review

- Review the change against correctness, regressions, and rollback risk before treating it as complete.
- Blocking findings escalate `review_findings: stop`.

### Stage 5 — checks

- Run the project command checks: `format`, `test`, `build` (use the project profile's mapped commands). `block_on_failure` is true — a failing gate stops forward progress; fix it before continuing.
- Verify test coverage meets the project bar.
- Run the `rule_compliance` gate (registered rule scripts, `mode: strict`, scope `changed-files`); deterministic findings escalate `stop`.
- Run the `module-health` rollup; rollup-blocked metrics are informational `warn`.

### Stage 6 — documentation_sync

- Sync the canonical docs affected by the change after verification passes (module docs, registries, design-system contract as the diff requires).
- Stale or missing doc updates escalate `stop`.

## Delivery

When the change is delivered, follow `docs/instructions/workflows/delivery-policy.yaml`: branch naming, conventional-commit format with the ticket in scope, PR title/body and ticket linkage, and the CI gate (`wait_for_green`; red CI is `on_red: stop`).

## Rules

- **Never skip a stage.** Every stage runs, in order, on every code change. A trivial change runs the stages lightly; it does not skip them.
- The mandatory safety stages (specification sign-off, checks, documentation_sync) are framework-owned and cannot be downgraded by a project override.
- Consult the workflow to decide the **lane** (how deep each stage goes), never to **omit** a stage.
- Point at the project's copy of the workflow files and follow them; never inline a frozen copy of the steps that ignores project overrides.
- Honor every escalation through the Decision Pause Contract — never resolve a `stop` silently.
