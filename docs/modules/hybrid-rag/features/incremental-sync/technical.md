# Incremental Sync — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `incremental-sync`

## Module Boundaries

- `src/rag/background-sync.ts` — `backgroundIndexSync`.
- `src/rag/service.ts` — `RagService.refreshContext` (the diff + re-embed + swap).
- `src/cli/commands/rag.ts` — `rag refresh-context` runs it.
- `runtime/hooks/context-refresh-trigger.mjs` — the prompt-time trigger (F5).

## Entry Points

- `backgroundIndexSync(projectRoot, providerFactory?)` →
  `{ synced: true } | { synced: false, reason: 'in-flight' | 'disabled' | 'no-index' | 'error' }`.

## Data Model / Schema

- Reuses `RagService.refreshContext`: `indexManager.sync` diffs by content hash →
  `syncVectorIndex` re-embeds only `changed_files` ∪ `added_files` → `replaceAll`
  atomic-swaps with refreshed `RagIndexMeta` (branch fields from F7).

## API / Interface Contract

- Single-flight lock at `.paqad/locks/rag-sync.lock` (F1 primitives); a held lock
  → `in-flight`.
- Gated on `getStatus()`: `enabled` false → `disabled`; `index_present`/`valid`
  false → `no-index` (an initial build is never triggered on a prompt).
- Never throws — any error resolves to `{ synced: false, reason: 'error' }`.
- Wiring: the F5 prompt trigger spawns `paqad-ai rag refresh-context --quiet`
  detached; that command runs `refreshRuleContext` (F5) then `backgroundIndexSync`
  (F9), so one debounced trigger refreshes both.

## State Management

- Stateless wrapper; durable state is the vector index + embedding cache under
  `.paqad/vectors/`.

## Failure Modes

- Lock held → `in-flight`. No index / disabled → respective reason. Sync throws →
  `error`, last-good index still serves.

## Tests

- `tests/unit/rag/service.test.ts` — a single-file edit re-embeds only that file's
  chunks; a branch switch self-heals `meta.branch`; no-index, disabled, and
  in-flight no-ops.
