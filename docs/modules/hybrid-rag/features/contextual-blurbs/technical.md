# Contextual Blurbs — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `contextual-blurbs`

## Module Boundaries

- `src/rag/contextual-blurb.ts` — `buildContextualBlurb`, `contextualizeChunkText`,
  `buildModuleRoleResolver`.
- `src/rag/service.ts` — `embedChunks` embeds the contextualised text; `fuseHybridRanking`
  BM25-indexes it.
- `src/module-map/reconciler.ts` — `readRawModuleMap` supplies the file → module role.

## Entry Points

- `buildContextualBlurb(chunk, { moduleRole? })` → `"[path · › signature · exports … · module: …]"`.
- `contextualizeChunkText(chunk, ctx?)` → `"<blurb>\n<content>"` (the embedded / indexed text).
- `buildModuleRoleResolver(projectRoot)` → `(file) => moduleName | undefined` (longest-prefix
  match over module-map sources; best-effort, never throws).

## Data Model / Schema

- No new persisted shape. The blurb is computed deterministically from the chunk fields
  (`source_file`, `ast_node_path`, `exported_symbols`) plus the module map.

## API / Interface Contract

- **Deterministic, no LLM.** The blurb is a pure function of the chunk + module map.
- **Two legs:**
  - Dense (embedding): `embedChunks` embeds `blurb + content` and keys the F8
    content-addressed cache by that text, so a blurb change re-embeds exactly like a
    content change. The module role is resolved once per build (`buildEmbedContextualizer`).
  - Lexical (BM25): `fuseHybridRanking` indexes `lexicalDocumentText(item)` = the blurb
    (path + signature + exported symbols, no query-time module-map lookup) + content, so
    exact identifiers/paths the bare body omits become matchable.
- **Content untouched.** The stored `chunk.content` (and the slice the model is shown) is
  never modified; only the embedded / indexed text carries the blurb.
- **Versioned.** Enabling blurbs changes the index contents, so `CHUNKER_VERSION` is
  `cast-blurb-v1`; a pre-blurb index reads as a mismatch and is cleanly rebuilt (F22).
- **Eval-gated.** A precision change must clear the F15 on/off eval gate (run in CI; no
  built index / embedding model in the unit-test environment).

## State Management

- Stateless. Reads the module map; writes nothing of its own (the contextualised text
  flows into the existing vector index / BM25 pool).

## Failure Modes

- No module map → role omitted (path/signature blurb only). A symbol-less chunk → path
  only. A vision chunk (no `source_file`) → bare content for BM25. Never throws.

## Tests

- `tests/unit/rag/contextual-blurb.test.ts` — blurb composition (all parts / omission /
  determinism), `contextualizeChunkText` prepend, and the module-role resolver
  (no-map / prefix match / longest-prefix-wins).
- `tests/unit/rag/service.test.ts` — the index meta records `cast-blurb-v1`; the 48
  service tests pass with the contextualised embed text + cache key.
