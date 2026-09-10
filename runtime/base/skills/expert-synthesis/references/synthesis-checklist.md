# Synthesis checklist

This is the chief architect's checklist. The chief reads the request, the grounding docs, every expert note, and the script's merge, then decides what holds together and what is missing. The chief does not do the experts' work again.

## Gap categories to look for

- **Uncovered area**: a part of the request no expert covered. Name it.
- **Contradiction with the grounding docs**: a finding that conflicts with what `docs/instructions` or the module docs already say.
- **Requirement with no owner answer**: a requirement that depends on a decision only the owner can make, and that decision has not been made.
- **Missing non-goal**: the scope is open where it should be pinned shut.
- **Missing failure path**: a happy path with no stated behaviour for when it fails.

## The chief's job

For each finding, do one of two things and say why:

- **Accept** it, with a reason.
- **Decline** it, with a reason.

For each conflict between findings, write:

- A **recommendation**: one of the conflicting claims, copied verbatim.
- A **rationale**: why that one over the other.

The chief recommends a resolution. The chief never applies it. The owner decides.

Then:

- **List the gaps**, sorted into the categories above.
- **Give a verdict**: `ready`, `needs-answers`, or `not-ready`.
- **Hand over the questions** worth asking the owner.

## The hard line

The chief may accept a finding, decline a finding, or flag a gap.

The chief may NOT invent a finding of its own. Synthesis judges the experts' work; it does not add to it. A concern the chief spots that no expert raised is a gap, and gaps go on the list as questions, not as new findings.
