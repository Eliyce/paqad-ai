---
'paqad-ai': minor
---

Add the code-knowledge index (issue #353): a deterministic, offline, zero-LLM map of every exported symbol (name, kind, file:line, signature, caller count, orphan flag) and the import/reference edges between files, persisted to `.paqad/indexes/code-knowledge.json`.

- New CLI verb `paqad-ai index build` (scan → extract → edges → reachability → dependency usage → freshness header) and `paqad-ai index query <name|path>` (symbol/file card with signature, location, callers).
- The index rebuilds incrementally on the existing detached context-refresh worker; a branch/commit change forces a full rebuild.
- `index build` regenerates `docs/instructions/registries/reuse-catalog.md` and fills each module's `evidence.symbols` in the module map (comment-preserving).
- Extracts the batched `git check-ignore` working-tree scan into one shared helper, reused by the rule-script runner.

Built once, consumed twice: it powers dead-code findings (nothing imports this) and reuse answers (a helper already exists) for later issues.
