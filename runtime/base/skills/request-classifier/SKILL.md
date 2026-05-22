---
name: request-classifier
description: Classify incoming requests into the framework routing model.
model_tier: fast
triggers:
  - workflow:
      - project-question
      - feature-development
      - bug-fix
      - refactor
      - migration
      - investigation
cacheable: true
cache_key_inputs:
  - request_text
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true
    description: Raw user request to classify.
  linked_spec_paths:
    type: path[]
    required: false
    description: Optional spec or issue files explicitly linked to the request.
on_complete:
  emit: classification_ready
  triggers:
    - router
---

## What It Does

Produces a deterministic request classification across the routing dimensions used by the framework so downstream skill and rule selection can rely on explicit signals instead of guesswork.

## Use This When

Use this at the start of a new request or whenever the effective scope changed enough that prior routing assumptions may no longer be safe.

## Inputs

- Read the request text, attached plan, and any directly linked issue or spec.
- Read the nearest canonical docs only when they clarify stack, module, or risk signals.
- Read `references/decision-rules.md` before assigning ambiguous dimension values.

## Procedure

1. Pipe the raw request into `scripts/extract-signals.sh` to get baseline keyword-derived dimensions (workflow, ui/api/db impact, scope, risk hint).
2. Override script defaults only when canonical evidence (linked spec, stack manifest, module map) contradicts them — record the override under Evidence.
3. Use `assets/dimensions.txt` for the allowed value set per dimension.
4. Default to most conservative accurate value when ambiguous; never invent certainty for risk/sensitivity.
5. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Classification` (one `key: value` per dimension) and `## Evidence` (bullet list for non-obvious calls).
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when stack, workflow, or impact dimensions cannot be inferred safely from the request.
- Warn when canonical docs contradict the request about modules, interfaces, or current behavior.
- Do not fabricate certainty for risk or sensitivity dimensions.

## Resources

- `references/decision-rules.md`
- `scripts/extract-signals.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/dimensions.txt`
- `runtime/base/skills/existing-doc-checker/SKILL.md`
- `agents/openai.yaml`
