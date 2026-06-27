# Codebase Memory — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `codebase-memory`

## Module Boundaries

- `src/context/codebase-memory.ts` — the store, the upsert, and the section composer.
- `src/context/rule-context.ts` — `writeRuleContext` threads the composed memory section
  into the single session-context artifact (ahead of the retrieval slice).
- `src/cli/commands/rag.ts` — `rag refresh-context` gathers and injects the section.

## Entry Points

- `loadCodebaseMemory(projectRoot)` → `CodebaseMemoryStore` (best-effort; empty on
  missing/corrupt, never throws).
- `upsertMemoryEntry(store, input, now)` → new store (pure; supersedes by `(kind, key)`).
- `recordCodebaseMemory(projectRoot, input, now?)` → load → upsert → atomic write.
- `composeMemorySection(entries, opts?)` → the `## Codebase memory` markdown, `''` when
  empty.
- `gatherCodebaseMemory(projectRoot, opts?)` → load + compose; `''` on any failure.

## Data Model / Schema

- Store: `{ version: 1, entries: CodebaseMemoryEntry[] }` at
  `.paqad/crs/codebase-memory.json` (under the already git-ignored `crs/` root, disjoint
  from the desktop's PQD-415 CRS collection subdirectories).
- Entry: `{ id: '${kind}:${key}', kind, key, text, updated_at, sources? }` where `kind`
  is `repo-fact | decision | recurring-failure | style`.

## API / Interface Contract

- **Deterministic-first.** No embeddings; recall is an exact read of the keyed store, so
  a remembered fact is never lost to a similarity miss. Works with RAG fully OFF.
- **Supersede, never duplicate.** `upsertMemoryEntry` replaces an entry with the same
  `(kind, key)` in place (position preserved), so the store never holds two contradictory
  copies — the "no confidently-wrong stale hit" guarantee.
- **Token-budgeted.** The section selects the freshest entries first, capped at
  `MAX_MEMORY_ENTRIES` (20) and trimmed to `MEMORY_SECTION_CHAR_BUDGET` (2000 chars).
- **Complement, never block.** Reads are best-effort and never throw; injection rides the
  background refresh and the session-context seam, never the prompt path.

## State Management

- The store is the only persisted state, written atomically via the F1 atomic-artifact
  swap so a reader never sees a half-written file. The injected section is part of the
  single session-context artifact (one writer, `writeRuleContext`), sitting between the
  rule slice (F5) and the retrieval slice (F11).

## Failure Modes

- Missing file, unreadable file, malformed JSON, or a non-store payload → empty store →
  empty section. Malformed individual entries are dropped on load. Never throws.

## Tests

- `tests/unit/context/codebase-memory.test.ts` — upsert appends / evolves-in-place /
  is pure; section grouping, recency order, count + char budgets, source provenance;
  disk round trip (recall in the next session), supersede-on-disk, corrupt-file and
  malformed-entry degradation.
- `tests/unit/context/rule-context.test.ts` — the memory section threads into the
  artifact ahead of retrieval, and a memory-only artifact is written when there are no
  compiled rules.
