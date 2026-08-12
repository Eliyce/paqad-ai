---
name: site-map-maintainer
description: Keep the site map fresh during a feature-development change — when a diff touches flow-relevant files, patch just the affected surfaces so the map never drifts from the code it describes.
model_tier: medium
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  changed_files:
    type: path[]
    required: true
    description: The files a feature-development change touched, checked for flow relevance.
---

## What It Does

Watches a feature-development change for edits that would drift the site map — a new route, a
changed guard, a removed screen — and patches only the affected surfaces. It is the reason a
change that touches navigation cannot reach "Safe to merge" with a stale map: the freshness gate
flags the drift, and this skill resolves it with a scoped patch, not a full re-map.

## Use This When

Use this inside a feature-development change, once the diff is known, when a changed file is one
the map cites or a flow-relevant path (routes, command programs, endpoint handlers, guards).
Skip it when the change touches nothing the map depends on.

## Inputs

- The change's `changed_files`.
- The stored `docs/site-map/app-map.yaml` and its stamped freshness (the broken-anchor count
  the freshness gate reads).
- Read `references/patch-scope.md` before patching.

## Procedure

The drift detection is the engine's (the stamped freshness records which cited anchors no
longer resolve); your job is the scoped patch.

1. Run `paqad-ai sitemap run`; read which cited anchors broke and which surfaces the changed
   files cite.
2. Patch only those surfaces — add the new one, update the changed guard, mark the removed one —
   leaving untouched surfaces exactly as curated.
3. Re-run the verb to confirm the freshness gate is satisfied and the map validates.

## Output Contract

- A JSON object `{ patched_surfaces: [...], anchors_repaired: [...], still_broken: [...] }`.
- Every patched surface carries resolving evidence from the changed files.
- `still_broken` is empty when the change is complete; a non-empty list is a blocking gap.

## Escalate / Stop Conditions

- Do not re-map the whole app for a scoped change; patch only what the diff drifted.
- Do not overwrite a curated surface that the change did not touch.
- Stop and surface the drift when a change removes a surface that journeys still reference — that
  is a decision, not a silent deletion.

## Resources

- `references/patch-scope.md`
- `agents/openai.yaml`
