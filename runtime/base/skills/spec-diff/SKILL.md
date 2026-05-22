---
name: spec-diff
description: Compare a new request against the current spec to classify coverage or conflict.
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - bug-fix
      - refactor
      - migration
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Incoming request to compare against the active spec.
  spec_paths:
    type: path[]
    required: true
    description: Active spec artifacts that define the current approved behavior.
---

## What It Does

Compares an incoming request against the active spec so the framework can tell whether the work is already covered, extends the spec, or conflicts with it.

## Use This When

Use this when new work arrives against an existing story or solution and you need to decide whether to continue, extend the spec, or stop because the request conflicts with approved behavior.

## Inputs

- Read the incoming request text from `request_text`.
- Read the active spec artifacts from `spec_paths`.
- Read `references/spec-diff-rules.md` before classifying the request.

## Procedure

1. Run `scripts/extract-ac-ids.sh <spec-paths...>` to load the canonical AC id set.
2. Extract behavior, constraints, and affected modules from the new request.
3. Compare against the active specs only; pick a decision token from `assets/decision-vocabulary.txt`.
4. Cite the exact AC id / passage that supports the call (or note that no AC matches).
5. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Spec Diff Decision` (decision token + justification), `## Evidence`, `## Implication`.
- Decision token must be `covered | extension | conflict`.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the active spec set is incomplete or internally contradictory.
- Warn when the request implies a behavioral conflict with the accepted solution.
- Do not silently respec work that is already covered by the current artifacts.

## Resources

- `references/spec-diff-rules.md`
- `scripts/extract-ac-ids.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/decision-vocabulary.txt`
- `.paqad/`
- `agents/openai.yaml`
