---
name: sequence-planner
description: Break work into ordered, coherent stories.
model_tier: reasoning
triggers:
  - workflow:
      - feature-development
      - refactor
      - migration
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  requirements_path:
    type: path
    required: true
    description: Accepted requirements artifact.
  acceptance_criteria_path:
    type: path
    required: true
    description: Acceptance criteria to sequence.
  canonical_doc_paths:
    type: path[]
    required: false
    description: Supporting canonical docs.
---

## What It Does

Builds a deterministic work sequence that orders stories by dependency, rollback safety, and verification readiness so teams do not discover critical prerequisites too late.

## Use This When

Use this after requirements are stable enough to split work, especially when database, contract, documentation, or UI changes must land in a deliberate order.

## Inputs

- Read the enriched requirements, acceptance criteria, and any existing plan fragments.
- Read the canonical docs for the affected modules and interfaces.
- Read `references/sequencing-rules.md` before assigning story boundaries.

## Procedure

1. List prerequisites, irreversible steps, and verification gates implied by the requirements.
2. Group tasks into independently reviewable stories — each must leave the system in a coherent state.
3. Apply the precedence rules in `assets/order-rules.txt` (schema → contracts → registries → flag → code → UI; irreversible steps last per workstream).
4. Attach a single verification focus to each story.
5. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Implementation Sequence`, per-story `### Story N — name` numbered sequentially from 1 with Goal/Dependencies/Verification/Reversibility/Blast-radius lines, and `## Sequencing Risks`.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when multiple valid orders exist but the tradeoff depends on release strategy or deployment controls.
- Warn when a requested sequence would force unsafe migration or contract timing.
- Do not combine unrelated workstreams just to reduce story count.

## Resources

- `references/sequencing-rules.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/order-rules.txt`
- `runtime/capabilities/coding/checklists/database-review-20pt.md`
- `agents/openai.yaml`
