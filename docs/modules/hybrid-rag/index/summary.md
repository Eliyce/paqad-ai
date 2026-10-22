# Hybrid RAG Runtime

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `hybrid-rag`

## Purpose

Optional vector index under `.paqad/vectors/`, hybrid scoring (vector
+ keyword + symbol + path), adaptive depth (none/standard/deep),
metadata filters, reranking (passthrough / local cross-encoder /
Cohere), and eval gates. Plugs into the semantic loader, not off
to the side.

## Source Footprint

- `src/rag`
- `src/project-knowledge`

## Features

- [Vector Index](../features/vector-index/business.md)
- [Embedding Providers (local / openai)](../features/embedding-providers/business.md)
- [Hybrid Scoring](../features/hybrid-scoring/business.md)
- [Reranking](../features/reranking/business.md)
- [Pattern Vectors](../features/pattern-vectors/business.md)
- [Eval Gates (hit@5, success, correction turns)](../features/eval-gates/business.md)
- [Branch-Aware Index (branch/commit/base metadata)](../features/branch-aware-index/business.md)
- [Embedding Cache (content-addressed, model-scoped)](../features/embedding-cache/business.md)
- [Incremental Sync (working-tree-following, background)](../features/incremental-sync/business.md)
- [Session Retrieval (top-k slices injected on the seam)](../features/session-retrieval/business.md)
- [Structural Repo-Map (embedding-free PageRank skeleton)](../features/repo-map/business.md)
- [Codebase Memory (deterministic cross-session repo facts)](../features/codebase-memory/business.md)
- [cAST Chunking (split-then-merge, chunker-versioned index)](../features/cast-chunking/business.md)
- [Contextual Blurbs (deterministic path/signature/role prefix before embed+BM25)](../features/contextual-blurbs/business.md)
- [Context Pack (distilled path:line pointers for long workflows)](../features/context-pack/business.md)
- [Base-Drift Awareness (debounced origin/base heads-up, off-path)](../features/base-drift/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file in `src/rag/`.

- **Attachments (`attachment-*.ts`, `orphan-sweep.ts`).** A session's attachment collection lives
  under `.paqad/attachments/<sessionId>/`, apart from the project index, so it is deleted with the
  session and never leaks across sessions; its id is the desktop's own session id. Every session
  id is checked to stay inside the attachments root before any write or `rm`, and the orphan sweep
  only deregisters an unsafe id, never deletes a path for it. The bulk indexer retries the
  provider after 1 s and 2 s, then returns an `attachment_indexing_degraded` result instead of
  throwing, so the message can still send without retrieval; a cancelled run purges its partial
  collection at once. The single-file indexer dedupes identical content by hash and bounds
  rate-limit retries with a wall-clock budget. PDF and archive extraction are injected by the
  consumer, so the package takes on no PDF or ZIP dependency, while the engine still owns every
  guard (page cap, zip-bomb ceiling, encrypted and corrupt detection). A corrupt registry or event
  line is treated as empty or skipped so nothing wedges. Attachment events go to their own log,
  not the RAG audit log.
- **`audit.ts`.** The flat audit line is written first and unconditionally, so a rag-evidence
  recorder failure never loses the event.
- **`background-sync.ts`.** Sync only touches an index that already exists (the first build stays
  an explicit `rag init` or `rebuild`), runs detached and single-flight, and reclaims a lock older
  than ten minutes as a crashed worker.
- **`base-drift.ts`.** The network step (a debounced `git fetch`) runs only in the background
  worker; the prompt path reads the stored snapshot. An `ls-remote` tip check skips the fetch when
  the remote base has not moved, and the debounce window opens before the fetch so a crash still
  floors the next attempt. Any git, network or auth failure means no drift is shown.
- **`contextual-blurb.ts`.** The blurb is prepended only to the text that is embedded and fed to
  BM25; the stored chunk content is never changed, so the slice the model sees stays clean. It
  rides the chunker version, so an index built without blurbs reads as a mismatch and is rebuilt.
  The module role comes from the longest matching module-map prefix.
- **CRS collections (`crs-*.ts`, `vector-index.ts`).** Collection ids are escaped to a
  filesystem-safe name (a colon is illegal on NTFS, and runs of dots are collapsed so no `..`
  can form), with a short hash appended whenever escaping changed the id so two ids never share a
  dir. The escape is a public contract. The write backlog is in memory only, so a restart loses
  queued chunks and an overflow is a data-loss signal. Destroy and reindex take a per-collection
  lock; reads do not, because the atomic rename swap always shows a complete state. A reindex
  keeps the old index under `.revert.<ms>` for 24 hours.
- **`embedding-cache.ts`.** The cache is keyed by the embedded text and scoped to one model, so a
  model change starts empty and a previously seen branch re-embeds nothing.
- **`file-filter.ts`.** fast-glob can return native separators on Windows, so results are made
  posix.
- **`git-state.ts`.** Every field is best-effort, so the index build never fails because of git.
- **`providers.ts`.** The local model is pinned to `q8` so the quantized files load as before;
  newer transformers versions default to fp32, which changes the download size and the vectors.
  The cache path is posix-normalized so it is the same on every platform.
- **`rerank-order.ts`.** Reranking only changes order: the original hits with their cosine scores
  are reattached, and hits the reranker did not score keep their relative order at the end.
- **`service.ts`.** One scoring path serves both retrieval and `rag probe`, so a probe shows the
  scores retrieval sees. The dense pool is fetched wider than the limit so BM25 can lift an exact
  identifier match. When nothing clears the similarity threshold, at most two slices inside the
  relief band are delivered and tagged low-confidence; with none, the best score is still carried
  so the consumer can show "none above the floor". An index built with a different chunker
  version must be fully rebuilt, since mixing chunk boundaries corrupts retrieval. RAG on or off is
  written to `.paqad/.config`, never the profile. `buildIndexOnly`, used by `join`, rebuilds
  without rewriting the tracked profile or the local `.config`. A cancelled rebuild writes a
  separate `.partial` index so a good `index.json` is never overwritten. A vision source path that
  is missing on disk is recorded, not rejected, because the desktop owns that file.
- **`src/context/retrieval-context.ts`.** Retrieval runs only in the background worker, never on
  the prompt path, and injects capped, truncated slices, not whole files. Without a prompt seed
  the query is the working set, because the precomputed artifact never sees the prompt; with a
  seed the prompt is the query and the paths ride along as keywords. Depth is gated by stage (or,
  without a classification, by how many modules the working set spans), and a self-contained stage
  skips retrieval. Code-changing workflows get docs and code slices; every other workflow stays
  docs-only. The floor is trusted from `RagService` and never re-applied here. Duplicate slices
  are dropped, keeping the best-ranked one. When retrieval scored something but nothing cleared
  the relief band, one line names the best score so a dark tier is visible; when nothing was
  scored at all the section is omitted, so a disabled RAG leaves the artifact unchanged. Relief
  slices are marked as weaker hints.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
