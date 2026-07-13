---
'paqad-ai': minor
---

RAG retrieval was dark: local-model cosine scores on hybrid-fused results rarely reached the 0.75 precision floor, so every query fell back below-floor and the model never received a slice. Retrieval now uses floor-with-relief — the 0.75 floor still marks high-confidence hits, but when nothing clears it the top slices at or above a new `rag_relief_floor` (default 0.35, chosen from live probe data) are delivered tagged low-confidence instead of nothing. When retrieval still finds nothing, the session-context artifact carries one honest line naming the best score instead of silently omitting the section.

Also wires the previously-defined-but-never-recorded `used` RAG-evidence event: the background context worker now records what it actually delivered into the artifact (injected sections, slice/pointer counts, top score, bytes) into the per-feature `.paqad/ledger/feature-evidence/<feature>/rag.jsonl`, so you can see whether RAG was used — not just that retrieval ran. Adds a `paqad-ai rag probe "<query>"` verb that prints pre-floor top-10 fused scores for diagnosis.
