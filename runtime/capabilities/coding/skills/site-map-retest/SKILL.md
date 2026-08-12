---
name: site-map-retest
description: Re-check the stored site map against the current code by running the same verification again — never invent a finding, never soften one, never call the absence of proof a fix.
model_tier: reasoning
triggers:
  - workflow:
      - site-map-retest
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  app_map:
    type: path
    required: true
    description: The stored docs/site-map/app-map.yaml the re-run verifies against the code.
---

## What It Does

Drives the same deterministic verification the `site-map` workflow runs and reads what changed:
the engine re-resolves every cited `file:line`, re-derives the findings, and re-stamps the
stored map's earned trust tiers and its map-vs-code freshness. There is no separate retest
engine and no report replay — a re-run is the same run again, and drift shows up as stamped
proof in the map itself.

## Use This When

Use this for the `site-map-retest` workflow: the user wants to know whether the map still
matches the code or prior gaps got fixed, not a fresh map.

## Inputs

- The stored map at `docs/site-map/` (the one source of truth).
- Read `references/replay-rules.md` before narrating any change.

## Procedure

The verification is the engine's; you drive it and narrate honestly.

1. Run `paqad-ai sitemap run` (or hit Run on the dashboard's Site map area); it verifies the
   stored map against the current code and stamps the earned trust and freshness back into it.
2. Read the drift: `anchors_broken > 0` in the stamped freshness means cited code no longer
   resolves. Finding ids are content-addressed (`SM-<hash8>`), so a persisting finding keeps
   its id and the baseline ratchet marks it `pre-existing`; a finding that disappears was
   resolved by whatever change removed its evidence.
3. Narrate the split in the paqad voice — Safe to merge only when the run exits clean and no
   cited anchor is broken.

## Output Contract

- A JSON object `{ findings: N, anchors_total: N, anchors_resolved: N, anchors_broken: N, new_since_baseline: N, pre_existing: N }`.
- The verdict is Safe to merge only when `findings` is 0 and `anchors_broken` is 0.

## Escalate / Stop Conditions

- Never invent a finding in a re-run; the engine's output is the only source.
- Never soften a finding: absence of proof is drift, not a fix — a surface whose cited
  evidence no longer resolves is a finding, never silently fine.
- Never hand-edit the stamped freshness; only the verb writes it.

## Resources

- `references/replay-rules.md`
- `agents/openai.yaml`
