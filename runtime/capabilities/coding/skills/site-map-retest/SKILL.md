---
name: site-map-retest
description: Replay a prior site-map report against the current code by stable SM- id — never invent a finding, never lower severity, never call the absence of proof a fix.
model_tier: reasoning
triggers:
  - workflow:
      - site-map-retest
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  source_sidecar:
    type: path
    required: true
    description: The prior run's JSON sidecar whose findings are replayed by id.
---

## What It Does

Drives the retest verb and reads its verdict: each prior finding is reclassified `fixed`,
`still-open`, or `needs-manual-verification`, matched by its content-addressed `SM-` id. It
never discovers new findings (that is a fresh `site-map` run) and never softens the source
report — the retest is an honest replay, not a re-grade.

## Use This When

Use this for the `site-map-retest` workflow: the user wants to know whether prior map gaps got
fixed or the map drifted, not a fresh audit.

## Inputs

- The source report sidecar (defaults to the newest `docs/site-map/*.json`, excluding retests).
- Read `references/replay-rules.md` before classifying any finding.

## Procedure

The reclassification is the engine's; you drive it and narrate honestly.

1. Run `paqad-ai sitemap retest` (optionally `--sidecar <path>`); it re-extracts, re-resolves,
   and reclassifies each source finding by id.
2. Read the retest sidecar: each finding is now `fixed`, `still-open`, or
   `needs-manual-verification`.
3. Narrate the split in the paqad voice — Safe to merge only when nothing is still open.

## Output Contract

- A JSON object `{ fixed: N, still_open: N, needs_manual_verification: N, findings: [...] }`.
- Every finding keeps its original `SM-` id and severity from the source report.
- The verdict is Safe to merge only when `still_open` is 0.

## Escalate / Stop Conditions

- Never invent a new finding during a retest; a new problem is a fresh `site-map` run.
- Never lower a finding's severity — severity is a property of the source report.
- A surface whose cited evidence no longer resolves is `still-open` (drift), never `fixed`;
  absence of proof is not a fix.

## Resources

- `references/replay-rules.md`
- `agents/openai.yaml`
