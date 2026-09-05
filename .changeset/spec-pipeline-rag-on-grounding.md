---
'paqad-ai': patch
---

spec-pipeline: S0 grounding now has a RAG-on path (FR-2.1, deferred from #512). A new
`groundAreaAsync` draws the touched area's vocabulary and references from the framework's
existing semantic retrieval seam (`gatherWorkingSetSlices`) when `rag_enabled` is on, and
falls back to the docs-glob `groundArea` when RAG is off or retrieval returns nothing. The
pipeline builds no cache and no reader of its own — only the existing retrieval/cache is
reused (FR-2.4 / FR-8.5). Grounding stays non-blocking (a thin area still succeeds and is
marked `sparse`), and the grounding artifact now records which `path` it took (`rag` or
`docs-fallback`). The `ground` CLI subcommand runs the RAG-aware path.
