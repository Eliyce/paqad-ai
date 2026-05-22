---
name: ux-state-machine
description: Define interface states and transitions for UI-heavy work.
model_tier: medium
triggers:
  - ui_impact:
      - new-component
      - new-screen
      - redesign
cacheable: true
cache_key_inputs:
  - docs/modules/*/ui/states.md
  - docs/modules/*/ui/screens.md
output_format: markdown
input_schema:
  flow_path:
    type: path
    required: true
    description: Flow or interaction artifact.
  state_doc_paths:
    type: path[]
    required: false
    description: Existing state docs.
---

## What It Does

Defines the user-visible states, transitions, and triggers for a changed interface so design, implementation, and documentation all operate from the same state model.

## Use This When

Use this when a UI change introduces new async behavior, branching flows, or recovery paths that are hard to reason about from the happy path alone.

## Inputs

- Read the affected screen or component docs and any existing state inventory first.
- Read `references/state-inventory-template.md` before enumerating states.
- Read `runtime/capabilities/coding/checklists/edge-cases-coding.md` to avoid missing loading, stale, and error paths.

## Procedure

1. Walk `assets/canonical-states.txt` (idle, loading, success, empty, error, disabled, stale, permission, retry); include every state the UI actually exposes.
2. For each transition, name the trigger explicitly (user event, async resolve, timeout, permission denied) — never imply it.
3. Build the table per `assets/output.template.md` (From / Trigger / To / Notes).
4. Surface any contradictory or undocumented state under `## Gaps`.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return sections named `State Inventory`, `Transitions`, and `Gaps`.
- Each state entry must name the visible UI condition and the user or system trigger.
- If no gaps remain, write `Gaps: none`.

## Escalate / Stop Conditions

- Ask when the request does not define the source of async updates, permissions, or recovery behavior.
- Warn when two states imply conflicting outcomes for the same trigger.
- Do not collapse materially different visible states into one generic label.

## Resources

- `references/state-inventory-template.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/canonical-states.txt`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
