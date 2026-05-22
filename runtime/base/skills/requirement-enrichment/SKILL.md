---
name: requirement-enrichment
description: Expand incomplete requests into enforceable requirements.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Initial request to enrich.
  canonical_doc_paths:
    type: path[]
    required: false
    description: Relevant canonical docs that constrain the work.
---

## What It Does

Expands a thin request into a requirement set that captures scope, constraints, dependencies, data handling, and operational assumptions before implementation planning begins.

## Use This When

Use this when the incoming request is directionally clear but still leaves room for conflicting interpretations, especially for medium or high-risk work that touches multiple systems or business rules.

## Inputs

- Read the raw request, tracker notes, and any linked issue or spec.
- Read the closest canonical module docs and glossary entries for the affected area.
- Read `references/enrichment-checklist.md` before drafting missing requirements.

## Procedure

1. Extract explicit asks, non-goals, constraints, dependencies, and acceptance expectations from source material.
2. Walk `assets/operational-checklist.txt` (permissions, auditability, rollback, data-retention, i18n, a11y, observability, docs, feature-flags) and add a confirmed requirement or open question for every item the request touches.
3. Invoke `edge-case-detection` as a sub-step on medium/high-risk work; fold material cases in tagged with their originating scenario. Never re-derive its rubric.
4. Separate confirmed from assumptions from unanswered.
5. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Confirmed Requirements`, `## Assumptions`, `## Open Questions`, in that order.
- Flat bullets, one requirement per bullet. Prefix `Blocked:` on bullets waiting on follow-up data.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when business rules, permissions, or data retention expectations are absent but clearly required.
- Warn when the request conflicts with canonical docs or previously approved behavior.
- Do not guess regulatory, billing, or irreversible data requirements.

## Resources

- `references/enrichment-checklist.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/operational-checklist.txt`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
