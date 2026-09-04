---
name: spec-quality-review
description: Optional pre-pass that surfaces spec defects for a human before freeze.
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

Surfaces likely spec defects — contradictions, formula inconsistencies, boundary gaps, goal conflicts, dangling references, and missing negative cases — as a human-readable list, so an author can fix them before freezing. It is an optional pre-pass, not the gate: `paqad-ai spec freeze` runs the authoritative, deterministic spec-quality review itself and blocks on a critical defect (issue #401). This skill neither persists a report nor hands anything authoritative downstream.

## Use This When

Use this after a spec edit and before you run `paqad-ai spec freeze`, or when an implementation bug suggests the spec may be internally inconsistent, to catch defects early rather than at freeze time. Skipping it changes nothing about the freeze — the freeze runs its own review regardless.

## Inputs

- Read the target spec markdown file in full.
- Read `references/spec-defect-checklist.md` before issuing findings.
- Use `agents/openai.yaml` for the reasoning contract when the workflow executes through agent infrastructure.

## Procedure

1. Run `scripts/scan-defects.sh <spec.md>` — it skips Open Questions and TBD lines and emits candidate hits across the categories in `assets/categories.txt` (vague-quantifier, missing-actor, unbounded-modal, tbd-leak, dangling-ref, goal-collision, no-negative).
2. Confirm each hit (or dismiss with a reason) — the script flags candidates, you judge severity.
3. Format a markdown summary per `assets/output.template.md`; validate it with `scripts/lint-output.sh`.
4. Order findings by severity, then by source line.

## Output Contract

- Return a `## Findings` section listing active defects with severity, category, location, and the specific clarification or rewrite needed.
- Return a `## Resolved` section only when a prior finding is now absent; omit it otherwise.
- Persist nothing. This pre-pass writes no `spec-review.json` and no `.paqad/compliance/**` file — the freeze owns the authoritative record (its defect summary is folded into the bundle's `specification.json`).

## Escalate / Stop Conditions

- Escalate when the review cannot locate the spec file or the file is not markdown.
- Stop short of rewriting the spec; report defects, do not auto-correct them.
- This pre-pass never gates the build and never blocks freeze — the freeze's own deterministic review is the blocker. Report findings honestly; do not imply this pass is authoritative.

## Resources

- `references/spec-defect-checklist.md`
- `scripts/scan-defects.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/categories.txt`
- `agents/openai.yaml`
