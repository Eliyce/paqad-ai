# Readiness criteria

The readiness verdict decides whether the map is worth building yet. It is graded from what the
engine can detect, never from optimism about what the code "probably" contains.

## The three verdicts

- **ready** — the app kind is detected and a dedicated extractor covers its shape (for example a
  Node CLI with a discoverable command program, or a service with a route convention the
  extractor recognises). The run proceeds with normal confidence.
- **partial** — the app kind is detected but only the generic convention fallback applies. The
  run proceeds in exploratory mode; every surface it produces is tagged `confidence: low` so a
  reader knows the map is a first pass, not a proof.
- **blocked** — no extractor covers the app shape. The engine records a `blocked_checks` entry
  with the reason. The run stops here; a map built by guessing surfaces is worse than no map.

## What counts as "detectable"

- The app kind (`web | api | cli | mobile | desktop | service | llm-workflows`) resolves from the
  manifests, not from a guess.
- At least one framework signal is present, or the generic route/command convention matches real
  files.

## Anti-false-positive discipline

- A `blocked` verdict is honest, not a failure to try harder. Do not invent an app kind to force
  a `ready` verdict.
- Do not treat an empty extraction as `ready` clean. An extractor that found nothing on a
  non-trivial app is evidence of a coverage gap, which is a `partial` or `blocked` signal, not a
  clean map.
