---
'paqad-ai': minor
---

One evidence packet per change (#581). Everything a change produces now lives in its feature bundle, and nothing goes to `.paqad/_specs/` any more. The signed `spec.md` is kept in the bundle, the pipeline's request, clarification and expert records are folded in, each fact is stored once, and every file and row carries the same six-field header. `evidence.jsonl` is always written, and the receipt seals its hash instead of copying rows. Existing projects migrate once, automatically, or by running `paqad-ai evidence migrate [--dry-run]`.
