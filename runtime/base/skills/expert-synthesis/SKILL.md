---
name: expert-synthesis
description: The chief architect for the spec pipeline. Read the request, the grounding, every expert note and the script's merge, then accept or decline each finding with a reason, recommend a resolution for each conflict (never apply it), list the gaps nobody covered, and give a readiness verdict. It is never picked by the detector; it runs automatically once any expert fired, and it may not invent a finding. The pipeline script validates the output and turns each conflict into a decision packet. Phase 2 of the spec pipeline (issue #547). TS guard is `src/spec-pipeline/experts/synthesis.ts`.
model_tier: reasoning
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  context:
    type: object
    required: true
    description: The JSON printed by `paqad-ai spec pipeline experts context`, with the request, the grounding, the label, the roster, every expert note, and the merge (findings with ids, and conflicts).
---

## What It Does

Reads everything the experts produced and synthesises it into one readiness call. The experts
each looked through their own lens; the chief reads across all of them plus the script's
deterministic merge, and does what no single expert can: it accepts or declines each finding with
a reason, it recommends a resolution for every conflict two experts raised (a recommendation, never
applied — that becomes a decision the human makes), it names the gaps no expert covered, and it
gives a verdict of `ready`, `needs-answers`, or `not-ready`.

The chief may accept, decline, or flag a gap. It may **not** invent a finding of its own — every
finding id it accepts or declines must be one the merge already knows. The pipeline script enforces
that, and turns each conflict into one `spec.expert_conflict` decision packet.

## Use This When

- The spec pipeline is running with the expert roster on and the experts' notes are recorded
  (`paqad-ai spec pipeline experts context` shows a `merge` that is not null). Run this once,
  after the notes step.

Do **not** run it when no expert fired — the chief only runs when at least one expert did.

## Inputs

- `context` — required. Print it with `paqad-ai spec pipeline experts context`. It holds:
  - `merge`: the merged findings (each with an id) and the conflicts. The script recomputes it
    from the recorded notes each time; it is never a file.
  - `notes`: the expert notes, for the reasons behind each finding.
  - `request`: the request text.
  - `grounding`: the grounding, so a finding that contradicts the docs is a gap.

Read `references/synthesis-checklist.md` for the gap categories to look for.

## Procedure

1. Print the context with `paqad-ai spec pipeline experts context` and read the request, the
   grounding, the notes and the merge in it.
2. For every merged finding id, accept it, or decline it with a one-line reason. Cover each id
   exactly once — an unaccounted finding is a gap in your own read.
3. For each conflict in the merge, write a recommendation that is one of that conflict's claims,
   verbatim, plus a rationale. Do not apply it; it becomes a decision the human resolves.
4. List the gaps by the categories in `references/synthesis-checklist.md`: an uncovered area, a
   contradiction with the grounding docs, a requirement with no owner answer, a missing non-goal, a
   missing failure path. Attach a plain-language question to a gap that needs one.
5. Give the verdict — `ready`, `needs-answers`, `not-ready` — and hand over the questions worth
   asking (business words; the plain-language check applies).
6. Validate with `scripts/lint-output.sh`, then hand the file to the pipeline:
   `paqad-ai spec pipeline experts synthesis <file>`. The verb stores your verdict in the
   change's `experts.json`, pointing at findings by id only; never write that file yourself.

## Output Contract

- A JSON object shaped like `assets/output.template.md`:
  `{ "verdict", "accepted": ["EX-…"], "declined": [ { "id", "reason" } ], "conflicts": [ { "target", "recommendation", "rationale" } ], "gaps": [ { "area", "why_it_matters", "question"? } ], "questions": [ PipelineQuestion ], "tokens" }`.
- `verdict` is one of `ready | needs-answers | not-ready`.
- Every merged finding id appears exactly once across `accepted` and `declined`; every conflict in
  the merge has exactly one row whose `recommendation` is one of its claims verbatim.

## Escalate / Stop Conditions

- Never accept or decline an id the merge does not know — you cannot add a finding.
- Never resolve a conflict yourself; recommend, and let the decision packet carry the choice.
- Never leave a merged finding unaccounted for, and never write a question in mechanism words.

## Resources

- `references/synthesis-checklist.md` — the gap categories and the chief's discipline.
- `assets/output.template.md` — the canonical output shape.
- `scripts/lint-output.sh` — validates the output shape before you hand it back.
- `runtime/base/skills/expert-synthesis/agents/openai.yaml` — agent interface metadata.
- `src/spec-pipeline/experts/synthesis.ts` — the deterministic guard that validates this output.
