---
'paqad-ai': minor
---

One evidence packet per change (#581). Everything a change produces now lives in its feature bundle, and nothing goes to `.paqad/_specs/` any more. The signed `spec.md` is kept in the bundle, the pipeline's request, clarification and expert records are folded in, each fact is stored once, and every file and row carries the same six-field header. `evidence.jsonl` is always written, and the receipt seals its hash instead of copying rows. Existing projects migrate once, automatically, or by running `paqad-ai evidence migrate [--dry-run]`.

The `.paqad/` schema version goes up to 1.1.0 for this. The first `paqad-ai update` or onboarding after you upgrade moves your old spec runs into their bundles on its own, one time. Files it cannot place are left in `.paqad/_specs/` and listed, a change another session still has open waits for a later run, and a file that cannot be deleted gives a warning instead of stopping the update. Pass `--session <id>` to `paqad-ai evidence migrate` so your own open change is not treated as someone else's.
