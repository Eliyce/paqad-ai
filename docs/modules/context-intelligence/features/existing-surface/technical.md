# Existing-Surface Planning Digest — Technical View

> Module: **Context Intelligence** (`context-intelligence`) · Layer: `framework-internals` · Feature slug: `existing-surface`

## Module Boundaries

- `src/context/existing-surface.ts` — `composeExistingSurfaceSection` (pure renderer),
  `gatherExistingSurface` (best-effort IO composer), `selectCandidateFiles` (scoping).
- `src/rag/repo-map.ts` — `buildProjectRepoMap` supplies the PageRank ranking (this is
  its first live, non-test consumer — issue #356 AC-5).
- `src/code-knowledge/store.ts` + `types.ts` — `readCodeKnowledgeIndex` supplies
  signatures, caller counts, lines, and module slugs when the #353 index exists.
- `src/code-knowledge/symbol-extractor.ts` — `extractSymbols` supplies exported names for
  the name-only fallback when no index is present.
- `src/context/rule-context.ts` — `writeRuleContext` appends the composed section on the
  feature-development slice; `src/cli/commands/rag.ts` (`rag refresh-context`) is the
  caller that composes it.

## Entry Points

- `composeExistingSurfaceSection(cards, { tokenBudget? })` → the `## Existing surface`
  markdown, or `''` for no cards. Cards are added in rank order until the budget is hit,
  then truncated with the honest `…and N more exported symbols` line.
- `gatherExistingSurface(projectRoot, { changedPaths?, query?, tokenBudget? })` →
  the composed section for the working set + prompt, or `''` when nothing is implicated.
- `selectCandidateFiles(allFiles, workingSet, query, index)` → the scoped candidate file
  list (working-set modules + prompt-named files/symbols).

## Data Model / Schema

- No persisted shape of its own. `ExistingSurfaceCard = { name, signature?, file, line?,
  callerCount?, module? }` is rendered to markdown and appended to the session-context
  artifact next to the rule slice.
- Card line: `` - `<signature|name>` — <file>[:<line>] · called from N place(s) · <module>``.

## API / Interface Contract

- **Route-gated (INV-1).** `writeRuleContext` composes the section only when
  `loadRules` is true (the feature-development route). A caller-supplied section on any
  other route is dropped, so the gating is structural, not caller-trusted.
- **Budget-bounded (INV-2).** The section never exceeds `existing_surface_tokens`
  (default `DEFAULT_EXISTING_SURFACE_TOKENS` = 1000) of card content; over-budget cards
  are dropped by rank, never silently included. The trailing truncation line is appended
  after the budget, mirroring the repo-map skeleton.
- **Two data sources, in order.** The code-knowledge index (full signature + caller
  count + line + module) when present; the repo-map / extractor resolvers (name-only)
  when absent (INV-3). A missing/corrupt index degrades to name-only, never a throw.
- **Ranking.** `buildProjectRepoMap` ranks the scoped candidate files by PageRank over
  their import edges; symbols within a file are ordered by caller count, then name.
- **Embedding-free.** No provider call; it works on both the lean (rag-off) and full
  (rag-on) `rag refresh-context` paths.

## State Management

- Stateless. Reads the code-knowledge index and the working tree; writes nothing of its
  own — the composed text flows into the existing session-context artifact.

## Failure Modes

- Empty scope (no working set, no prompt hit) → `''` (byte-identical to today).
- No index → name-only cards. Unreadable candidate file → skipped. Any composer throw →
  `''` (the background worker is never wedged).

## Tests

- `tests/unit/context/existing-surface.test.ts` — format pinned (AC-5), ≥5 cards within
  budget (AC-1), route gating drops/keeps the section (AC-2/INV-1), name-only fallback
  (AC-3), rank-truncation + honest line on a huge fixture (AC-4), candidate scoping.
- `tests/unit/code-knowledge/repo-index.integration.test.ts` — asserts
  `buildProjectRepoMap` now has its first production caller (`src/context/existing-surface.ts`).
