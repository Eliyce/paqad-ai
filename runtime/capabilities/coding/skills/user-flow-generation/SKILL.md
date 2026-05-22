---
name: user-flow-generation
description: Generate or update user flows for UI-facing features.
model_tier: medium
triggers:
  - ui_impact:
      - new-component
      - new-screen
      - redesign
cacheable: true
cache_key_inputs:
  - docs/**/*.md
  - runtime/templates/user-flow.md.hbs
output_format: markdown
input_schema:
  story_path:
    type: path
    required: true
    description: Story artifact describing the feature.
  module_doc_paths:
    type: path[]
    required: false
    description: Relevant module docs.
---

## What It Does

Generates or updates user flow documentation for UI-facing work so primary, alternate, and failure paths are explicit for design, engineering, QA, and docs maintenance.

## Use This When

Use this when the request changes a screen, component, or major interaction path and the canonical flow docs need to describe the resulting user journey clearly.

## Inputs

- Read the request, current user-flow docs, and relevant UI docs first.
- Read `references/user-flow-sections.md` before writing or revising a flow.
- Read the current state inventory and heuristic notes if they exist.

## Procedure

1. Define Actor / Entry / Success up top per `assets/output.template.md`.
2. Write the Primary Flow as an ordered, user-observable list — defer implementation steps to technical docs.
3. Walk `assets/branch-categories.txt` (Empty, Loading, Error, Permission, Retry, Blocked); add a sub-flow only when the change touches that branch.
4. Keep names consistent with the glossary and screen docs.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return sections named `Primary Flow`, `Alternate Paths`, and `Flow Gaps`.
- List each flow step as an ordered item written from the user or system perspective.
- If the flow is fully documented, write `Flow Gaps: none`.

## Escalate / Stop Conditions

- Ask when the actor, entry point, or success condition is not defined clearly enough to map the journey.
- Warn when the requested UI behavior conflicts with existing flow docs or state definitions.
- Do not turn technical implementation steps into user-flow steps.

## Resources

- `references/user-flow-sections.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/branch-categories.txt`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
