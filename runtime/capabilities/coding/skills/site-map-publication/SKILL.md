---
name: site-map-publication
description: Curate the token-budgeted index prose and the overview narrative for the published site map — prose only, because the index, Mermaid overview, and registries are generated deterministically by the engine.
model_tier: medium
triggers:
  - workflow:
      - site-map
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  app_map:
    type: path
    required: true
    description: The compiled app-map.yaml the published views are generated from.
---

## What It Does

Curates the human-facing prose of the published map: the short narrative in the token-budgeted
`index.md` and the framing around the overview. The structured views — the `index.md` skeleton,
the `overview.md` Mermaid, and the screen/API registries — are generated deterministically by
the engine; this skill writes only the words a person reads, within the budget.

## Use This When

Use this last, after assembly and verification, once the map validates. It publishes; it does
not change the map's structure.

## Inputs

- The compiled `app-map.yaml` and the engine's generated views.
- The token budget for `index.md` (the always-loaded tier is capped).
- Read `references/publication-budget.md` before writing prose.

## Procedure

The views are generated; you curate only the narrative, and only within budget.

1. Run `paqad-ai sitemap run`; it publishes `index.md`, the `overview.md` Mermaid, and the
   registries, and reports the token budget and any tier it had to drop.
2. Write the index narrative: what the app is, its main areas, and the entry points — short
   enough to stay inside the budget, with an omission note when a tier was dropped.
3. Frame the overview: a sentence per area that helps a newcomer read the diagram. Do not restate
   the diagram in prose.

## Output Contract

- Markdown prose for `index.md` and the overview framing, inside the token budget.
- An explicit omission note whenever the budget forced an optional tier to be dropped.
- No structural edits to the generated views — prose only.

## Escalate / Stop Conditions

- Stop and note the omission when the budget cannot fit every tier; never silently drop content
  that makes the map read as complete when it is not.
- Do not hand-edit the generated Mermaid, index skeleton, or registries — the engine owns them.
- Do not narrate a surface or journey the map does not contain.

## Resources

- `references/publication-budget.md`
- `agents/openai.yaml`
