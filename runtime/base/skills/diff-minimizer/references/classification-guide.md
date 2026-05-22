# Step Classification Guide

Use this guide when classifying each step of a proposed solution.

## ac-satisfying

The step is required to make a specific acceptance criterion observable. Removing the step would mean a stated AC cannot be verified. Cite the AC id (`AC-1.1`, `AC-2.3`) on every entry.

Example: a story for AC-1.1 "creates an invite" must include the database insert step. That step is `ac-satisfying`.

## necessary-setup

The step does not directly satisfy an AC, but another step (which IS `ac-satisfying`) cannot work without it. Examples: schema migration before query code, shared type before consumer, configuration value before the feature reads it.

A step is only `necessary-setup` when:

- another step in the same plan depends on it, AND
- removing it would break that other step at compile or run time.

If both conditions are not true, classify as `scaffolding` or `over-build`.

## scaffolding

The step adds defensive code, abstraction, or structure that the spec did not ask for. Common scaffolding patterns:

- `try/catch` around an internal call whose failure cannot occur or is already surfaced
- Null guards on values from typed sources where the type already excludes null
- Extra abstraction layer used in only one place
- Logging or metrics not requested by an AC or NFR

Recommend a leaner alternative or a deletion. Do NOT classify as scaffolding if the project's canonical module docs declare the pattern as a project convention.

## over-build

The step adds a feature, optimization, or generality that no AC requested and no other step requires. Examples:

- New `Repository` class for one query
- Pagination added to an endpoint when no AC mentions list-size limits
- Caching layer when no NFR mentions latency
- Configurable strategy where the spec demands one fixed behavior

Recommend deletion or splitting into a separate, explicitly out-of-scope story.

## When in doubt

If a step is genuinely ambiguous, do not guess — emit it under `Open Questions` with a one-line description of the ambiguity. Do not invent justification for keeping or dropping a step.
