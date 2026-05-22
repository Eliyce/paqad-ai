---
name: spec-quality-review
description: Run deterministic spec defect analysis before compliance extraction.
model_tier: reasoning
triggers:
  - doc:
      - spec
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  spec_file:
    type: path
    required: true
    description: Markdown specification file to review.
---

## What It Does

Runs a structural review over a spec to find contradictions, formula inconsistencies, boundary gaps, goal conflicts, dangling references, and missing negative cases before the spec is treated as authoritative.

## Use This When

Use this before `spec-compliance-extract`, after a spec edit, or when an implementation bug suggests the spec may be internally inconsistent.

## Inputs

- Read the target spec markdown file in full.
- Read `references/spec-defect-checklist.md` before issuing findings.
- Reuse the persisted `.paqad/compliance/<spec-slug>/spec-review.json` report when it exists so resolved findings can be carried forward.
- Use `agents/openai.yaml` for the reasoning contract when the workflow executes through agent infrastructure.

## Procedure

1. Run `scripts/scan-defects.sh <spec.md>` — it skips Open Questions and TBD lines and emits candidate hits across the categories in `assets/categories.txt` (vague-quantifier, missing-actor, unbounded-modal, tbd-leak, dangling-ref, goal-collision, missing-negative).
2. Confirm each hit (or dismiss with reason) — the script flags candidates, the LLM judges severity.
3. Persist the machine-readable report under `.paqad/compliance/<spec-slug>/spec-review.json`.
4. Format markdown summary per `assets/output.template.md`; validate with `scripts/lint-output.sh`.
5. Order findings by severity, then by source line.

## Output Contract

- Return a `Findings` section summarizing active defects with severity, category, location, and required clarification.
- Return a `Resolved` section when prior findings are now absent.
- Keep the machine-readable source of truth in `.paqad/compliance/<spec-slug>/spec-review.json`.

## Escalate / Stop Conditions

- Escalate when the review cannot locate the spec file or the file is not markdown.
- Stop short of rewriting the spec; the review reports defects but does not auto-correct them.
- Treat the review as advisory: downstream extraction may continue even when critical defects remain.

## Resources

- `references/spec-defect-checklist.md`
- `scripts/scan-defects.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/categories.txt`
- `agents/openai.yaml`
