---
'paqad-ai': minor
---

Wire paqad's built-but-unused RAG + smart-rule machinery into live sessions as an optional, eval-gated accelerator on top of the grep/agentic default — never blocking, token-saving, deterministic-first, and honest (27 features, F1–F27).

- **Non-blocking spine (F1–F3):** a detached background-worker harness (atomic swap, single-flight lock, debounce) and a `UserPromptSubmit` seam that injects a precomputed context artifact under a hard time budget. Disabled / cold-start / `rag_enabled=false` emits nothing — byte-identical to today's behavior.
- **Smart rule loading (F4–F6):** an always-resident rule manifest plus deterministic trigger-loaded full rule text (no embeddings for rules), and live `PreToolUse`/`Stop` rule-script enforcement so lazy rule text stays safe.
- **Branch-aware index substrate (F7–F10):** branch/commit/base metadata, a content-addressed embedding cache (idempotent re-embeds, zero-cost branch switch-back), background incremental working-tree sync, and a `rag_base_branch` config knob.
- **Retrieval wired into sessions (F11–F14):** top-k slices injected on the seam, a precision floor with live-file-verify framing, docs/module-map-first scope, and stage-aware gating.
- **Prove + honest (F15–F16):** an on/off A/B eval gate (hit@k, task-success, prompt-tokens) that blocks regressions, and README/docs copy corrected to match what actually ships.
- **Code retrieval + precision (F17–F19):** hybrid BM25 + RRF fusion, an opt-in reranker, and stage-routed function-level code slices — all safe-by-construction and eval-gated.
- **Higher structure (F20–F21):** an embedding-free structural repo-map (import-graph PageRank skeleton) and a deterministic cross-session codebase-memory tier (supersede-by-key, token-budgeted).
- **Polish (F22–F27):** cAST split-then-merge chunking with a chunker-versioned index (clean rebuild on strategy change), an opt-in code-tuned local embedding model (MiniLM stays the default floor), deterministic contextual blurbs before embed + BM25, decision-precedent enrichment on the decision pause, a distilling context pack (path:line pointers, not dumps) for long workflows, and proactive base-drift awareness (debounced off-path `origin/<base>` heads-up).

All retrieval/precision changes are gated by the F15 eval; retrieval stays off until `rag_enabled` is set, and every path falls back cleanly to grep when disabled, cold, or below the similarity floor.
