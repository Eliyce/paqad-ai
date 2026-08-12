---
'paqad-ai': patch
---

feat(#468): Phase C — writer cutover, retire the old evidence paths, add a warn-only existence gate

Third and final PR of the #339/#468 evidence-in-bundle cutover — the only phase that changes the on-disk layout, now that both writers (Phase A) and readers (Phase B) are proven.

- RAG (the deferred piece): the `runtime/scripts/rag-evidence-record.mjs` prompt seam and the TS recorder now write retrieval rows to the two-home `rag.jsonl` (the active feature's bundle, else `_chat/<session>/`), with the conversation ordinal re-homed to `_chat/<session>/`; the retired `paqad.rag-evidence/` substrate is gone. `foldRagEvidenceSession` reads `_chat` + the bundle projection (`readAllFeatureRag`) filtered by session.
- Writer cutover: the completion seam stops the old-home writes — the `rule-evidence` project ledger, the top-level `evidence.jsonl` / `receipts.jsonl` / `receipt.dsse.json` / `ai-bom.json`, and the duplication/change-metrics project ledgers — keeping every engine cache (`report.json`, `drift.json`, `duplication.json`) and the per-feature bundle receipt/evidence. The reproducibility context stamp moves to `.paqad/session/context-stamp.json`. `src/rule-scripts/rule-ledger.ts` is retired.
- Existence gate: a new `evidence_existence_gate=off|warn` knob (default `warn`, no exit-blocking tier) verifies the bundle's `rule-run.jsonl` / `duplication.jsonl` / `change-metrics.jsonl` / `rag.jsonl` exist backfill-first — minting the recoverable three deterministically from the caches (marked `backfilled: true`), and reporting an unrecoverable RAG absence as Inconclusive. Flag-aware: a flag-off / RAG-dark / copy-only / non-feature-dev change reads skipped, never a hard block.
