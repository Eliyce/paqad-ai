# Inferencer Scoring Model

The hypothesis former lives in `src/module-decisions/inferencer.ts`.

## Tokenisation

- Lowercase, strip non-alphanumerics, split on whitespace / `/_-`.
- Drop tokens shorter than 3 characters and a small closed stop-word set
  (`and`, `the`, `module`, `feature`, etc.).
- Deduplicate.

## Signal sources (per existing module)

- Module name + slug.
- Each feature's name + slug.
- Source-path basenames (glob suffixes and file extensions stripped).
- Evidence symbols, routes, tables.

## Weighting

- Name/slug token matches count 2x.
- All other matches count 1x.

This makes a hit on `Logging` (the module name) outscore a hit on `logging`
appearing inside an unrelated module's source path.

## Score

```
weighted_matches / max(1, prompt_token_count)
```

Capped at 1.0. The default confidence floor is 0.2.

## Fallback choices

Two fallback `InferenceChoice` entries are always appended to the result:

- `new-module-fallback` — the agent collects a name and loops back through
  the extractor.
- `no-attribution` — proceed without any `module-map.yml` mutation.

This guarantees the Decision Pause packet is complete even when no existing
module clears the floor.
