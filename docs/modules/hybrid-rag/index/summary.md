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
- [Embedding Providers (local / openai / voyageai)](../features/embedding-providers/business.md)
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
