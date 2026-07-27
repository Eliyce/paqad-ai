---
name: site-map-assembly
description: Drive the compile verb that folds the surface, transition, and guard layers into app-map.yaml, and resolve merge conflicts against the locked committed content without overwriting curated entries.
model_tier: fast
triggers:
  - workflow:
      - site-map
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  run_bundle:
    type: path
    required: true
    description: The site-map run bundle whose modeled layers compile into app-map.yaml.
---

## What It Does

Compiles the modeled layers — surfaces, transitions, guards, areas — into the single
`app-map.yaml` of record, and reconciles them against what is already committed. The compile is
the engine's; this skill drives it and resolves conflicts by preserving locked human-curated
content rather than clobbering it.

## Use This When

Use this after modeling and flow tracing, once the layers are ready to become one map. It
precedes verification and publication.

## Inputs

- The run bundle's modeled layers (surfaces, transitions, guards).
- The committed `docs/instructions/site-map/app-map.yaml`, if one exists.
- Read `references/merge-policy.md` before resolving any conflict.

## Procedure

The compile and its schema validation are the engine's; do not hand-assemble the YAML.

1. Run `paqad-ai sitemap run`; it compiles the layers into `app-map.yaml` and validates the
   result against the app-map schema.
2. Read the reconciliation: entries added, entries the committed map already covers, and any
   conflict between a fresh layer and a curated entry.
3. Resolve each conflict per the merge policy — locked, human-curated content wins over a
   re-derived layer; a genuine change is surfaced, not silently overwritten.

## Output Contract

- A JSON object `{ compiled: true, app_map_path, added: [...], preserved: [...], conflicts: [...] }`.
- `compiled` is `true` only when the engine's schema validation passed.
- Every conflict names the curated entry it preserved and why.

## Escalate / Stop Conditions

- Stop when schema validation fails; a map that does not validate is not written.
- Do not overwrite a locked, human-curated entry to resolve a conflict — surface the change for a
  human decision.
- Do not hand-edit `app-map.yaml` outside the compile; the engine owns its shape.

## Resources

- `references/merge-policy.md`
- `agents/openai.yaml`
