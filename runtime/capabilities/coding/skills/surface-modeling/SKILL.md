---
name: surface-modeling
description: 'Turns raw extracted surfaces into named, typed, module-attributed surfaces with entry and exit marks, the layer the engine cannot infer from code. Use when extraction is done and flow tracing has not started.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: json
  paqad-meta: skill.meta.yaml
---

## What It Does

Adds the layer the code cannot carry on its own: a semantic slug, a human title, the surface
kind, entry and exit marks, and the owning module for each extracted surface. This is the one
stage where the map gains meaning beyond what a scanner sees, so it is the one stage where
judgment is load-bearing and must stay honest.

## Use This When

After extraction and before flow tracing. Every surface the map publishes passes
through here to get its name and type.

## Inputs

- The `extraction.json` from `surface-extraction` (raw surfaces with evidence).
- The module map, to attribute each surface to the module that owns it.
- Read `references/modeling-judgment.md` before naming or typing a surface.

## Procedure

The mechanical checks (slug rules, evidence resolution, accounting) belong to the engine's
lint; your job is the naming and typing judgment.

1. For each extracted surface, assign a semantic slug, a title, and a kind
   (`page | screen | modal | action | api | cli-command | job | router | terminal | …`).
2. Mark entry points and exits, and attribute the surface to its owning module via the module map.
3. Account for every extracted entry: mapped, or excluded with a stated reason. Re-run
   `paqad-ai sitemap run` so the engine lints slugs, evidence, and accounting.

## Output Contract

- A JSON object `{ surfaces: [{ id, slug, title, kind, area, module, entry, evidence }], excluded: [{ id, reason }] }`.
- Every modeled surface carries a resolving `file:line` evidence pointer.
- Every extracted entry appears in `surfaces` or `excluded`: none is dropped silently.

## Escalate / Stop Conditions

- Do not name a surface the extractor never produced, and do not drop an extracted surface
  without an explicit `excluded` reason.
- Stop and ask when a surface's kind is genuinely ambiguous rather than guessing a type that
  changes how the graph reads.
- Keep the slug derived from evidence, not invented; a slug with no basis in the code is a defect.

## Resources

- `references/modeling-judgment.md`
- `agents/openai.yaml`
