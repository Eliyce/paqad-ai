---
name: regression-test-gen
description: Suggest regression coverage for changed stack behavior.
model_tier: medium
triggers:
  - workflow:
      - bug-fix
      - refactor
      - migration
cacheable: true
cache_key_inputs:
  - tests/**
  - src/**
output_format: markdown
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Implementation files requiring regression coverage.
  acceptance_criteria_path:
    type: path
    required: false
    description: Acceptance criteria for traceability.
---

## What It Does

Generates regression recommendations that stay tightly scoped to changed behavior and are grouped by test layer so follow-up verification work is deliberate and efficient.

## Use This When

Use this after a bug fix, refactor, or migration once the changed behavior is understood and you need to decide what regression coverage should prove it stays fixed.

## Inputs

- Read the changed behavior, existing tests, and claimed verification scope first.
- Read the stack-specific testing guide that matches the project.
- Read `references/regression-layer-map.md` before proposing new coverage.

## Procedure

1. List the concrete behaviors changed by the request and ignore unrelated nearby surfaces.
2. Map each changed behavior to the narrowest meaningful test layer that can catch regression.
3. Reuse existing suites, fixtures, and patterns before suggesting new harnesses.
4. Group recommendations by unit, integration, end-to-end, or manual verification layer.
5. Call out any changed behavior that should remain manual only and explain why.

## Output Contract

- Return sections named `Unit`, `Integration`, `End-to-End`, and `Manual Verification` in that order.
- Under each section, list only the changed behaviors that belong to that layer.
- If a layer has nothing to add, write `<Layer>: none`.

## Escalate / Stop Conditions

- Ask when the available test harness is unknown and would materially change the layer recommendation.
- Warn when a requested regression check is broader than the changed behavior and likely to create noise.
- Do not recommend generic full-suite reruns as a substitute for behavior-focused regression coverage.

## Resources

- `references/regression-layer-map.md`
- `runtime/capabilities/coding/stacks/laravel/references/tools/testing.md`
- `agents/openai.yaml`
