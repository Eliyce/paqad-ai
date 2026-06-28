---
'paqad-ai': minor
---

Add the RAG-evidence ledger and harden the release workflow (issue #249).

- **Release fix:** `changeset version` no longer hard-fails on a transient GitHub GraphQL flake. A resilient changelog adapter keeps the rich GitHub changelog when the API is healthy and falls back to a git-style line on any error.
- **Session-ledger substrate (#249 P0):** a reusable, script-written, session-scoped append-only JSONL primitive (atomic ordinal allocation, `.open` pointer, script-clock `ts` + identity `content_hash`, tolerant reader, injectable validator) under `.paqad/ledger/`, consumable by the stage-evidence ledger (#247) too. Imports no enterprise code (always-on, AI-BOM-independent).
- **RAG-evidence ledger (#249 P1–P3):** a per-(session, conversation) record of what RAG actually did — `refreshed` / `called` / `used` / `fallback` — recorded from the real seams (background worker + prompt hook); `appendRagAudit` dual-writes into the structured ledger so it is the queryable source of truth with no event lost. AJV-validated, script-only (the LLM never hand-authors a row). `paqad-ai rag-evidence show` folds a session into a use-rate / fallback rollup. Honest by design: proof of occurrence, never of benefit.
