---
name: ux-heuristic-evaluation
description: Evaluate UI behavior against usability heuristics.
model_tier: medium
triggers:
  - ui_impact:
      - new-component
      - new-screen
      - redesign
cacheable: true
cache_key_inputs:
  - docs/modules/*/ui/components.md
  - docs/modules/*/ui/screens.md
output_format: markdown
input_schema:
  ui_surface_paths:
    type: path[]
    required: true
    description: UI surfaces or docs to evaluate.
  request_text:
    type: string
    required: false
    description: Optional evaluation scope.
---

## What It Does

Evaluates changed UI behavior against a defined heuristic rubric so usability issues are reported as concrete user-impact findings instead of subjective design opinions.

## Use This When

Use this for any meaningful UI change once the target flow and states are known, especially before final review or documentation handoff.

## Inputs

- Read the affected UI docs, flow notes, and current state inventory first.
- Read `references/heuristic-rubric.md` before evaluating the interface.
- Read the relevant stack-specific browser validation guide if behavior needs interactive confirmation.

## Procedure

1. Walk every heuristic in `assets/heuristics.txt` against the changed interface; never skip a category silently.
2. Tie each issue to a user task, state, or observed confusion point — never style preference.
3. Bucket findings into Blocking Issues vs Improvement Opportunities per `assets/output.template.md`.
4. Note any UI doc that must update because the heuristic reveals missing state documentation.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return sections named `Blocking Issues` and `Improvement Opportunities`.
- Each finding must state the affected screen or component, the heuristic violated, and the user impact.
- If no issues are found, write `Blocking Issues: none` and `Improvement Opportunities: none`.

## Escalate / Stop Conditions

- Ask when the expected user goal or task completion path is unclear.
- Warn when the interface appears to conflict with accessibility or recovery expectations.
- Do not file purely stylistic preferences as heuristic issues.

## Resources

- `references/heuristic-rubric.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/heuristics.txt`
- `runtime/capabilities/coding/stacks/flutter/references/tools/playwright.md`
- `agents/openai.yaml`
