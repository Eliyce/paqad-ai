# Session Retrieval — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `session-retrieval`

## Module Boundaries

- `src/context/retrieval-context.ts` — `gatherWorkingSetSlices`, `composeRetrievalSection`.
- `src/context/retrieval-depth-router.ts` — `gateRetrieval` (stage → depth/topN/skip).
- `src/context/rule-context.ts` — `writeRuleContext` / `refreshRuleContext` append
  the retrieval section to the single session-context artifact.
- `src/rag/service.ts` — `RagService.retrieveForEval` (the actual query).
- `src/cli/commands/rag.ts` — `rag refresh-context` runs sync → gather → compose.

## Entry Points

- `gatherWorkingSetSlices(projectRoot, { service?, changedPaths?, topN? })` →
  `RetrievalSlice[]` (`{ source_file, content, score? }`); `[]` on any fallback.
- `composeRetrievalSection(slices)` → markdown `## Retrieved context` section, or
  `''` when there are no slices.

## Data Model / Schema

- The query is built from the working set (changed file paths + basenames), not the
  user's prompt — the artifact is precomputed in the background (SWR).
- Slices are the `retrieved_chunks` of `RagRetrievalResult`, scored from
  `vector_scores`.
- Scope (F13): `RetrievalScope = 'docs' | 'code' | 'all'`. `isDocScopedPath` marks
  `docs/instructions/`, `docs/modules/`, and the module-map as docs. Default is
  `docs` — module docs become on-demand relevance slices (~1-2K tokens) instead of
  the wholesale ~20-40K whole-doc load. `filterToScope` drops out-of-scope slices.

## API / Interface Contract

- Capped at `MAX_RETRIEVAL_SLICES` (5); each body truncated at `MAX_SLICE_CHARS`
  (1200) — a slice, never a whole file.
- Scope-first (F13): retrieval is routed over docs only by default; a code-only
  working set with no matching doc slice injects nothing and the agent stays on
  grep. Code slices are the F19 extension.
- Stage gating (F14): `gateRetrieval` turns stage signals into `{ depth, topN,
  skip }`. A self-contained stage (trivial single-file / trivial investigation)
  skips retrieval entirely — no embed, no query. A system-wide / high-risk stage
  pulls a deeper candidate pool. With no live classification, the gate derives
  scope from working-set breadth (`deriveScopeFromWorkingSet`). An explicit `topN`
  overrides the gate (eval/test hook).
- Section is appended AFTER the rule slice (F5) so the seam injects one artifact.
- Precision floor (F12): `applyPrecisionFloor(slices, floor)` drops any slice below
  the floor OR without a score before injection. The floor is the project's
  `rag_similarity_threshold` (default **0.75**) — one tuned threshold governs both
  retrieval and injection. `RagService` already filters at this value; re-applying
  it at the consumer makes the injection boundary self-defending.
- Calibrated framing (F12): the section is advisory ("re-read the live files; the
  match % is the index's confidence, not correctness") and each slice heading shows
  its match strength (`### path · match 91%`) so the model can weigh a hint.

## State Management

- Stateless. Reads the vector index under `.paqad/vectors/`; writes only the
  session-context artifact (via the rule-context writer, atomic + single-flight).

## Failure Modes

- rag disabled / no index / stale index / below similarity threshold / retrieval
  error → `gatherWorkingSetSlices` returns `[]` → empty section → artifact stays
  rule-only, byte-equivalent to F5 (disabled == today). Never throws.

## Tests

- `tests/unit/context/retrieval-context.test.ts` — compose/cap/truncate; gather
  returns slices, forwards topN, and falls back to `[]` on empty/throw/no-working-
  set; artifact integration (rule slice precedes retrieval slice; empty section is
  rule-only; retrieval-only when no rules).
