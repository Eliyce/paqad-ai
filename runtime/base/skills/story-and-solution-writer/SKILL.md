---
name: story-and-solution-writer
description: Turn scoped work into story and solution artifacts.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  requirements_path:
    type: path
    required: true
    description: Accepted requirements artifact.
  sequence_plan_path:
    type: path
    required: true
    description: Implementation sequence artifact.
  canonical_doc_paths:
    type: path[]
    required: false
    description: Relevant canonical docs.
---

## What It Does

Produces implementation-ready story and solution prose that ties problem framing, constraints, approach, and verification together without collapsing into code-level detail.

## Use This When

Use this when requirements and sequence exist but the execution artifact still needs a clear narrative that engineering, review, and documentation work can all follow.

## Inputs

- Read the enriched requirements, acceptance criteria, and current sequence plan.
- Read the closest canonical docs and any stack-specific guidance for the affected surface area.
- Read `references/story-template.md` before drafting the artifact.

## Procedure

1. Summarize the user or business problem in one paragraph grounded in the request.
2. State the constraints, dependencies, and non-goals that shape the solution.
3. Describe the proposed approach in ordered steps that explain the workflow goal without writing code.
4. Tie each major approach decision back to acceptance or verification needs.
5. List documentation or rollout work that must happen alongside implementation.

## Output Contract

- Match `assets/output.template.md`: `## Story`, `## Constraints`, `## Proposed Solution`, `## Verification Notes`. Optional `## Pending Decisions` when applicable.
- Each section must trace back to the request, not invent rollout or migration steps unsupported by the known system context.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the approach depends on an unresolved architecture choice or cross-team dependency.
- Warn when the requested scope is too broad for one coherent story artifact.
- Do not invent rollout or migration steps that are not supported by the known system context.

## Resources

- `references/story-template.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `runtime/base/skills/acceptance-criteria-gen/SKILL.md`
- `agents/openai.yaml`
