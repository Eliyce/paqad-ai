---
'paqad-ai': minor
---

Add the duplication gate (#358): a deterministic, new-code-only detector that flags when a change introduces code near-copying something the project already has, before the change is called done — and stays quiet on legacy duplication it did not cause.

- Zero model tokens: pure token-shingle computation over the existing chunk index, with a fallback that works even when no embedding index is present.
- Binds at the verification backstop (a `duplication` gate whose verdict lands in the end-of-change receipt) and ships a `paqad-ai duplication scan [--json]` CLI verb.
- New knobs `duplication_mode` (off | warn | strict, default warn for a two-cycle bake-in), `duplication_similarity_threshold` (default 0.90), and `duplication_min_lines` (default 8).
- A blocking finding can be accepted through the existing create-vs-reuse Decision Pause; the resolved packet unblocks it and is noted in the report.
- Consolidates three near-identical private cosine implementations into one canonical `cosineSimilarity` helper.
