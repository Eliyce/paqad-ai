---
name: expert-synthesis
description: "The spec pipeline's chief architect: reads the request, the grounding, every expert note and the merge, accepts or declines each finding with a reason, recommends a resolution for each conflict without applying it, lists the gaps nobody covered and gives a readiness verdict. Use when the expert notes are recorded and experts context shows a merge."
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: json
  paqad-meta: skill.meta.yaml
---

## What It Does

Reads everything the experts produced and synthesises it into one readiness call. The experts
each looked through their own lens; the chief reads across all of them plus the script's
deterministic merge, and does what no single expert can: it accepts or declines each finding with
a reason, it recommends a resolution for every conflict two experts raised (a recommendation, never
applied: that becomes a decision the human makes), it names the gaps no expert covered, and it
gives a verdict of `ready`, `needs-answers`, or `not-ready`.

The chief may accept, decline, or flag a gap. It may **not** invent a finding of its own, every
finding id it accepts or declines must be one the merge already knows. The pipeline script enforces
that, and turns each conflict into one `spec.expert_conflict` decision packet.

## Use This When

- The spec pipeline is running with the expert roster on and the experts' notes are recorded
  (`paqad-ai spec pipeline experts context` shows a `merge` that is not null). Run this once,
  after the notes step.
- You run as the chief architect's own subagent (`paqad-chief-architect`) once every
  High Table seat has recorded its note. The context you print then holds every seat's note.

Do **not** run it when no expert fired: the chief only runs when at least one expert did.

## Inputs

- `context`: required. Print it with `paqad-ai spec pipeline experts context`. It holds:
  - `merge`: the merged findings (each with an id) and the conflicts. The script recomputes it
    from the recorded notes each time; it is never a file.
  - `voice_warnings`: findings whose target is not a name this project uses. Settle
    each one: rename it to the project's word in `renames`, or leave it when it is a genuinely new
    thing.
  - `notes`: the expert notes, for the reasons behind each finding.
  - `request`: the request text.
  - `grounding`: the grounding, so a finding that contradicts the docs is a gap.

Read `references/synthesis-checklist.md` for the gap categories to look for.

## Procedure

1. Print the context with `paqad-ai spec pipeline experts context` and read the request, the
   grounding, the notes and the merge in it.
2. For every merged finding id, accept it, or decline it with a one-line reason. Cover each id
   exactly once: an unaccounted finding is a gap in your own read.
3. Rule every conflict in the merge, with a rationale. If the claims can all be true at once,
   rule it `compatible` and write the `merged_claim` that says all of them; the merged claim
   restates every must-level constraint of the claims it merges. Use `pick` only when following
   one claim means not following another, and copy the claim you recommend verbatim into
   `recommendation`. Never pick between claims that agree. A pick becomes a decision the owner
   makes; a compatible ruling becomes one accepted finding and asks the owner nothing.
   A conflict that includes a must-level security-auditor finding is always a pick, so the owner
   decides it.
4. List the gaps by the categories in `references/synthesis-checklist.md`: an uncovered area, a
   contradiction with the grounding docs, a requirement with no owner answer, a missing non-goal, a
   missing failure path. Attach a plain-language question to a gap that needs one.
5. Give the verdict: `ready`, `needs-answers`, `not-ready`, and hand over the questions worth
   asking (business words; the plain-language check applies).
6. Validate with `scripts/lint-output.sh`, then hand the file to the pipeline:
   `paqad-ai spec pipeline experts synthesis <file>`. The verb stores your verdict in the
   change's `experts.json`, pointing at findings by id only; never write that file yourself.

## Output Contract

- A JSON object shaped like `assets/output.template.md`:
  `{ "verdict", "accepted": ["EX-…"], "declined": [ { "id", "reason" } ], "conflicts": [ { "target", "ruling": "pick", "recommendation", "rationale" } | { "target", "ruling": "compatible", "merged_claim", "rationale" } ], "gaps": [ { "area", "why_it_matters", "question"? } ], "questions": [ PipelineQuestion ], "tokens" }`.
- `verdict` is one of `ready | needs-answers | not-ready`.
- Every merged finding id appears exactly once across `accepted` and `declined`; every conflict in
  the merge has exactly one row. A `pick` row's `recommendation` is one of its claims verbatim. A
  `compatible` row carries a non-empty `merged_claim`. A row with no `ruling` reads as `pick`.

## Escalate / Stop Conditions

- Never accept or decline an id the merge does not know: you cannot add a finding.
- If the claims can all be true at once, rule compatible and write the merged claim. Use pick only
  when following one claim means not following another. Never pick between claims that agree.
- Never rule compatible on a conflict that includes a must-level security-auditor finding, and never
  drop a must-level constraint from a merged claim.
- Never leave a merged finding unaccounted for, and never write a question in mechanism words.

## Resources

- `references/synthesis-checklist.md`: the gap categories and the chief's discipline.
- `assets/output.template.md`: the canonical output shape.
- `scripts/lint-output.sh`: validates the output shape before you hand it back.
- `runtime/base/skills/expert-synthesis/agents/openai.yaml`: agent interface metadata.
- `src/spec-pipeline/experts/synthesis.ts`: the deterministic guard that validates this output.
