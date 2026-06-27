# Embedding Cache — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `embedding-cache`

## Module Boundaries

- `src/rag/embedding-cache.ts` — `EmbeddingCache`, `chunkHash`,
  `EMBEDDING_CACHE_RELPATH`.
- `src/rag/service.ts` — `embedChunks` consults the cache.

## Entry Points

- `chunkHash(text)` → `sha256(text)` (the cache key).
- `EmbeddingCache.load(projectRoot, model)` → an in-memory cache for that model.
- `cache.get/has/set(text[, vector])`, `cache.size`, `await cache.flush()`.

## Data Model / Schema

- On-disk: `{ version, model, entries: { [hash]: number[] } }` at
  `.paqad/vectors/embedding-cache.json` (gitignored).
- The whole file is scoped to one model; loading for a different model yields an
  empty cache (invalidation).

## API / Interface Contract

- `embedChunks` computes the miss set (`!cache.has(content)`), embeds only those
  via the provider in batches, `cache.set`s each result, and assembles every
  chunk's vector from the cache (hits + new). `flush` is called once at the end
  (and on cancellation, to persist work already done).
- `flush` is a no-op when nothing changed since load; otherwise it atomic-writes
  via the background harness's `atomicWriteFile`.

## State Management

- In-memory `Map<hash, number[]>` with a `dirty` flag; the only persisted state is
  the JSON file.

## Failure Modes

- Missing / corrupt / wrong-model file → empty cache, never throws.
- Cancellation mid-build → cache is flushed so embeds done are not lost; the
  partial checkpoint is the chunks already cached.

## Tests

- `tests/unit/rag/embedding-cache.test.ts` — deterministic hash; set/has/get;
  flush round-trip; model-change invalidation; corrupt-file empty; no-op flush.
- `tests/unit/rag/service.test.ts` — a rebuild over unchanged sources calls the
  provider 0 times; a model change re-embeds.
