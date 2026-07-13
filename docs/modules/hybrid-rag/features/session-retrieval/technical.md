# Session Retrieval — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `session-retrieval`

## Module Boundaries

- `src/context/retrieval-context.ts` — `gatherWorkingSetSlices`, `composeRetrievalSection`.
- `src/context/retrieval-depth-router.ts` — `gateRetrieval` (stage → depth/topN/skip).
- `src/context/rule-context.ts` — `writeRuleContext` / `refreshRuleContext` append
  the retrieval section to the single session-context artifact.
- `src/rag/service.ts` — `RagService.retrieveForEval` (the actual query),
  `RagService.probe` (pre-floor diagnostic), `scoreCandidates` (the one scoring path).
- `src/cli/commands/rag.ts` — `rag refresh-context` runs sync → gather → compose →
  record the `used` evidence; `rag probe "<query>"` prints pre-floor scores.

## Entry Points

- `gatherWorkingSetSlices(projectRoot, { service?, changedPaths?, topN? })` →
  `{ slices: RetrievalSlice[], bestScore: number | null }`. `bestScore` is the top
  pre-floor score (or `null` when retrieval never scored anything); each slice is
  `{ source_file, content, score?, lowConfidence? }`.
- `composeRetrievalSection(slices, { bestScore? })` → markdown `## Retrieved context`
  section. Non-empty slices render fenced blocks; an empty result with a known
  `bestScore` renders one honest "none above the floor (best N%)" line; a fully unknown
  result (no `bestScore`) renders `''` (disabled == today).
- `RagService.probe({ taskDescription, keywords }, topN?)` → `RagScoredCandidate[]`
  scored BEFORE the floor — the diagnostic behind `paqad-ai rag probe`.

## Data Model / Schema

- The query is built from the working set (changed file paths + basenames), not the
  user's prompt — the artifact is precomputed in the background (SWR).
- Slices are the `retrieved_chunks` of `RagRetrievalResult`, scored from
  `vector_scores`.
- Scope (F13/F19): `RetrievalScope = 'docs' | 'code' | 'all'`. `isDocScopedPath` marks
  `docs/instructions/`, `docs/modules/`, and the module-map as docs. `filterToScope`
  drops out-of-scope slices. When `scope` is unset, `scopeForWorkflow` routes by stage
  (F19): code-changing workflows (feature-dev plan/implement/verify, bug-fix, refactor,
  migration, …) get `all` (docs + function-level code slices — chunks are already
  AST-node-level, so it sends a function, not a file), while doc/writing/question
  workflows and the no-workflow background default stay `docs`. Docs slices are
  on-demand relevance (~1-2K tokens) vs the wholesale ~20-40K whole-doc load.

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
- Floor-with-relief (#354): the floor lives in ONE place — `RagService`. Candidates at
  or above `rag_similarity_threshold` (default **0.75**) are high-confidence hits. When
  none clear it, the top `RELIEF_SLICE_CAP` (2) candidates at or above `rag_relief_floor`
  (default **0.35**, chosen from live probe data — local-model cosine on hybrid-fused
  results tops out ~0.37-0.52 for on-target queries) are delivered tagged
  `low_confidence`. Below the relief band too → dark, but `best_score` still flows out.
  The consumer no longer re-applies a floor (one canonical resolution): it trusts the
  service result and only tags + scopes it.
- Calibrated framing: a high-confidence section is advisory ("re-read the live files; the
  match % is the index's confidence, not correctness") with per-slice match strength
  (`### path · match 91%`); a relief section is labelled "low-confidence … nothing cleared
  the confidence floor"; a dark turn shows the honest best-score line so the tier is never
  silently missing.

## State Management

- Stateless. Reads the vector index under `.paqad/vectors/`; writes only the
  session-context artifact (via the rule-context writer, atomic + single-flight).

## Failure Modes

- rag disabled / no index / stale index / retrieval error → `gatherWorkingSetSlices`
  returns `{ slices: [], bestScore: null }` → empty section → artifact stays rule-only,
  byte-equivalent to F5 (disabled == today). Never throws.
- Scored but below the relief band (a genuinely irrelevant query, e.g. the "kubernetes
  ingress" negative control) → `slices: []` with a numeric `bestScore` → the honest
  one-line "none above the floor" section, so the dark tier is visible, not missing.

## Tests

- `tests/unit/context/retrieval-context.test.ts` — compose/cap/truncate; gather
  returns slices, forwards topN, and falls back to `[]` on empty/throw/no-working-
  set; artifact integration (rule slice precedes retrieval slice; empty section is
  rule-only; retrieval-only when no rules).
