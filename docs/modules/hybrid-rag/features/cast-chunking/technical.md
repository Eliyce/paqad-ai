# cAST Chunking — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `cast-chunking`

## Module Boundaries

- `src/context/ast-chunker.ts` — `AstChunker` (split), `castMerge` (merge),
  `CHUNKER_VERSION`.
- `src/rag/vector-index.ts` — `replaceAll` stamps `chunker_version` into the meta.
- `src/rag/service.ts` — passes `CHUNKER_VERSION` on build/sync; `getStatus` invalidates
  on a chunker-version mismatch.
- `src/rag/types.ts` — `RagIndexMeta.chunker_version?`.

## Entry Points

- `new AstChunker(maxChunkChars?, merge?).chunk(filePath, content)` → `Chunk[]`. With
  `merge` on (default) the boundary split is followed by the cAST merge.
- `castMerge(chunks, targetChars)` → `Chunk[]` (pure split-then-merge refinement).
- `CHUNKER_VERSION` (`'cast-v1'`) — the strategy tag.

## Data Model / Schema

- `RagIndexMeta.chunker_version?: string` — set only for the AST-chunked file index
  (vision/CRS collections leave it undefined).

## API / Interface Contract

- **cAST merge is safe-by-construction.** It only joins chunks that were already adjacent
  within one file, never crosses a file boundary, never drops or reorders content, and
  passes an already-oversize chunk through verbatim (a single chunk is returned without
  re-hashing). A merged chunk re-hashes its id/content_hash, unions `exported_symbols`,
  and joins `ast_node_path` with `+`.
- **Index is versioned by chunker.** `replaceAll` stamps `chunker_version`; `getStatus`
  marks the index invalid when RAG is on and the stored version != `CHUNKER_VERSION` (a
  pre-F22 index has none, which reads as a mismatch). An invalid index is never
  incrementally synced (which would mix chunk boundaries) and the background sync skips
  it — it is fully rebuilt on the next explicit build, mirroring the provider/model
  mismatch path (F8).
- **tree-sitter is the documented future upgrade.** Swapping the regex boundary detector
  for a tree-sitter parser is the contested, dependency-heavy half; it rides the same
  `CHUNKER_VERSION` seam (bump the version → clean rebuild) and must clear the F15 eval
  gate first, exactly like the reranker (F18) and the code-tuned model (F23).

## State Management

- Stateless chunking. The only persisted state is `chunker_version` in the index meta,
  written atomically with the rest of the meta.

## Failure Modes

- Malformed source → `fallbackSplit` (paragraph buffer). Chunking never throws.
- A chunker-version mismatch degrades to grep (index invalid) until a full rebuild — no
  corruption, no mixed-strategy index.

## Tests

- `tests/unit/context/ast-chunker.test.ts` — `castMerge` coalesces small adjacent
  same-file chunks, starts a new chunk at the budget, never crosses files, passes
  oversize through verbatim, unions symbols + re-hashes, drops no content; `AstChunker`
  merges by default and exposes `CHUNKER_VERSION`.
- `tests/unit/rag/service.test.ts` — the meta records `cast-v1`; an index with a
  mismatched/absent `chunker_version` is invalid (chunker reason) and is not
  incrementally synced.
