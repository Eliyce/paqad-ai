# Extraction evidence

Extraction is the deterministic floor of the map: a surface exists only if the code proves it.
This reference is the bar for accepting, excluding, or flagging a surface.

## What resolving evidence means

- Every surface carries at least one `file:line` that a reader can open and see the surface
  declared — a route registration, a command definition, an endpoint handler.
- `derivation: static` means the extractor read the declaration directly. `derivation: convention`
  means it matched a naming or directory convention; those are weaker and downstream skills tag
  them `confidence: low` until confirmed.

## Dedupe discipline

- The same surface reached two ways (a route and its alias) is one surface with unioned evidence,
  not two. The engine dedupes by a stable fingerprint; do not re-split a deduped surface.

## Anti-false-positive discipline

- Do not accept a surface the extractor did not ground. If the engine could not resolve its
  evidence, it is a flag, not an entry.
- An empty extraction on a non-trivial app is a coverage gap to surface, never a clean map to
  celebrate. Record it as a `blocked_checks` entry with the reason the extractor found nothing.
- The fingerprint is the identity of the extraction. If two runs over the same tree produce
  different fingerprints, something non-deterministic leaked in — investigate, do not paper over it.
