# Structural Repo-Map — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `repo-map`

## Module Boundaries

- `src/rag/repo-map.ts` — `pageRank`, `buildRepoMap`, `buildProjectRepoMap`.
- `src/graph/import-scanner.ts` — `scanImports` supplies the import edges.

## Entry Points

- `pageRank(seedNodes, edges, opts?)` → `Map<path, score>` (iterative, dangling-mass
  handling, ignores self-imports).
- `buildRepoMap(files, edges, { tokenBudget? })` → `{ entries, skeleton, truncated }`.
- `buildProjectRepoMap(projectRoot, { files, aliases?, moduleOf?, symbolsOf?,
  tokenBudget? })` → same, sourcing edges from `scanImports`.

## Data Model / Schema

- Input: project-relative posix file paths + directed import edges + optional
  module-map role and exported symbols per file.
- Output: a markdown `## Repo map` skeleton, one ranked line per file
  (`` `path` · module · symbols``), within a token budget (default 1500).

## API / Interface Contract

- Embedding-free: the only signals are static import edges and the project's own
  module-map roles / symbols, so it works with RAG and embeddings fully OFF. Ranking
  and formatting are pure; only `buildProjectRepoMap` touches disk (the import scan).
- Token-budgeted: lines are added by descending PageRank until the budget is hit, then
  truncated with a visible marker. The full ranking is still returned in `entries`.
- Designed to refresh incrementally in the background harness (F1) with the working
  tree, like the rest of the buildout.

## State Management

- Stateless. No persisted artifact of its own yet; the skeleton is intended to be
  injected via the session-context seam alongside the rule and retrieval slices
  (multi-producer artifact coordination is shared with F21 memory).

## Failure Modes

- No files → empty skeleton (`''`), `truncated: false`. Unreadable files are skipped
  by the import scanner. Never throws on a malformed source file.

## Tests

- `tests/unit/rag/repo-map.test.ts` — PageRank ranks an import hub above its leaves,
  seeds lonely nodes, ignores self-imports; `buildRepoMap` orders by rank and respects
  the token budget; `buildProjectRepoMap` scans real edges from a temp project.
