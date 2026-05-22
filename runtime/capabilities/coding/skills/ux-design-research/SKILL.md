---
name: ux-design-research
description: Research external UI references for full-lane UI work.
model_tier: reasoning
triggers:
  - process_depth:
      - full lane
    ui_impact:
      - new-component
      - new-screen
      - redesign
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: UX problem to research.
  current_ui_paths:
    type: path[]
    required: false
    description: Current UI docs or screenshots.
---

## What It Does

Collects external and internal UI references for high-scope interface work, translating them into concrete guidance on flows, states, and interaction patterns rather than mood-board commentary.

## Use This When

Use this only for full-lane work that also changes screens, components, or major redesigns. It should not activate for non-UI work or small graduated-lane interface adjustments.

## Inputs

- Read the request, current UI docs, and affected flow or screen inventory first.
- Read `references/research-capture-format.md` before gathering examples so findings stay structured.
- Read the stack-specific browser validation guide that matches the project surface.

## Procedure

1. Define the target interaction, user goal, and constraints before collecting references.
2. Gather only sources that inform navigation, state handling, feedback, or visual hierarchy for the changed flow.
3. Summarize each useful reference in terms of the concrete behavior it suggests, not just aesthetics.
4. Translate findings into project-specific recommendations tied to states, flows, and validation needs.
5. Call out any internal pattern conflict or accessibility concern revealed by the research.

## Output Contract

- Match `assets/output.template.md`: `## Research Targets`, `## Reference Findings`, `## Recommended Directions`.
- Every Reference Finding states **Pattern** and **Why it matters here**; never aesthetics-only.
- Sources must be dated and quoted minimally — no long quotations.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the design goal or target user is too vague to choose meaningful references.
- Warn when research points toward a pattern that conflicts with established product constraints or accessibility needs.
- Do not present external inspiration as a mandate without mapping it to the project context.

## Resources

- `references/research-capture-format.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `runtime/capabilities/coding/stacks/laravel/references/tools/playwright.md`
- `agents/openai.yaml`
