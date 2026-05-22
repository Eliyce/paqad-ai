---
name: test-per-ac-planner
description: Map acceptance criteria to specific verification actions.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  acceptance_criteria_path:
    type: path
    required: true
    description: Acceptance criteria artifact.
  changed_files:
    type: path[]
    required: false
    description: Implementation files under test.
---

## What It Does

Maps each acceptance criterion to the narrowest useful verification path so important behavior does not reach implementation without a proof strategy.

## Use This When

Use this after acceptance criteria exist and before coding or handoff, especially when the work spans multiple layers or mixes automated and manual verification.

## Inputs

- Read the current acceptance criteria and sequence or story artifact first.
- Read the existing test layout and stack verification guidance for the affected modules.
- Read `references/verification-mapping.md` before selecting test layers.

## Procedure

1. Run `scripts/extract-ac-ids.sh <ac-file>` to load the canonical AC id set.
2. For each AC, choose the smallest test layer that can prove it; reuse existing test patterns/files before proposing new surfaces.
3. Assign each test a `T{ac}.{idx}` id whose `{ac}` segment matches the parent AC (script-checked).
4. Add manual verification only when automation is not practical.
5. Format per `assets/output.template.md` and run `scripts/check-coverage.sh <ac-file> <plan>` to find uncovered ACs; record those under `## Uncovered Criteria`.
6. Validate the final markdown with `scripts/lint-output.sh`.

## Output Contract

- Return a heading named `Verification Plan`.
- For each criterion, emit a third-level heading combining the AC identifier with its assigned test ids, e.g. `### AC-1.1 → T1.1, T1.2`.
- Under each heading, provide a table with columns `Test ID`, `Layer`, `File`, `Case`, and `Notes`.
- Tests must reference the AC identifier in their test name or enclosing describe block so failure evidence can be traced back via the regex `/AC-\d+(?:\.\d+)?/`.
- End with `Uncovered Criteria` listing any AC identifier that still lacks a viable proof path.

See `assets/output.template.md` for the canonical shape; lint enforces it.

## Escalate / Stop Conditions

- Ask when the available test harness or environment is unknown and materially changes the recommendation.
- Warn when the request expects coverage that the current stack cannot provide without new infrastructure.
- Do not mark a criterion covered if the proposed test only exercises an implementation detail.

## Resources

- `references/verification-mapping.md`
- `scripts/extract-ac-ids.sh`
- `scripts/check-coverage.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `runtime/capabilities/coding/stacks/laravel/references/tools/testing.md`
- `agents/openai.yaml`
