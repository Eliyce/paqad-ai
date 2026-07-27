---
name: journey-synthesis
description: Propose a small set of capped, well-formed journeys over the verified map — one actor, one goal, ordered evidenced steps, dual ends — all marked proposed for human confirmation, never auto-confirmed.
model_tier: reasoning
triggers:
  - workflow:
      - site-map
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  app_map:
    type: path
    required: true
    description: The compiled, verified app-map.yaml whose surfaces and transitions the journeys compose.
---

## What It Does

Turns the verified map into a few important journeys — the goal-directed paths an actor takes
through the surfaces. Proposes at most the configured cap, each a well-formed arc42-style
journey (one actor, one goal, ordered steps, branches, dual ends), and marks every one
`proposed`. It never confirms a journey and never touches the graph layers; humans confirm
through the audited surface.

## Use This When

Use this after the map is assembled and verified, when the user wants journeys (not just the
surface map). Skip it when the map itself is still incomplete — journeys compose surfaces that
must already exist.

## Inputs

- The compiled `app-map.yaml` (surfaces, transitions, guards).
- Signals that a path matters: tests, analytics, README hints.
- Read `references/journey-shape.md` before proposing a journey.

## Procedure

The journey shape is script-lintable; your job is choosing which few paths matter and grounding
each step.

1. Digest the hints (tests, analytics, README) for the paths that carry real user value.
2. Propose at most the configured cap: each journey names one actor, one goal, an entry, ordered
   steps (surface + action + expectation), branches, and dual ends; every step references an
   existing surface (and, where it moves, an existing transition). Mark each `proposed`.
3. Write the journey files to `docs/instructions/site-map/journeys/<id>.journey.yaml` and re-run
   `paqad-ai sitemap run` so the engine lints each journey's shape and step references.

## Output Contract

- A JSON object `{ journeys: [{ id, actor, goal, entry, steps, ends, status, evidence }], over_cap: [...] }`.
- `status` is `proposed` for every synthesized journey — never `confirmed`.
- Every step references an existing surface id; the journey count never exceeds the cap.

## Escalate / Stop Conditions

- Never mark a journey `confirmed`; that is a human decision through the audited surface.
- Never invent a surface to make a journey flow — a missing surface is a gap for the
  app-cartographer, not a step to fabricate.
- Propose few, important journeys over an exhaustive dump; when over the cap, drop the least
  load-bearing and say why.

## Resources

- `references/journey-shape.md`
- `agents/openai.yaml`
