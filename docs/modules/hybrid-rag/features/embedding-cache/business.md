# Embedding Cache — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `embedding-cache`

## Overview

A content-addressed cache that makes re-embedding idempotent. Each chunk's text
is hashed; if its embedding for the current model is already cached, it is reused
instead of calling the embedding provider again. So an unchanged chunk is never
re-embedded, switching to a previously-seen branch re-embeds nothing, and only
genuinely new or changed text costs a provider call (and tokens).

This page describes **Embedding Cache** from a business perspective. The
technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — fast, cheap index refreshes; branch switches do not re-pay for
  embeddings already computed.
- **paqad-ai contributor** — the substrate the incremental working-tree sync (F9)
  builds on for "re-embed only what changed."

## User Flows

- **Build / sync:** before embedding, each chunk's text is looked up in the cache;
  only misses are sent to the provider; new vectors are stored and persisted.
- **Branch switch:** the new branch's chunks are mostly already cached → near-zero
  new embeds.
- **Model change:** the cache is scoped to a model, so a different model starts
  fresh.

## Business Rules

- The cache is keyed by chunk-text hash and scoped to the embedding model.
- A model change invalidates the cache (loads empty); a corrupt cache loads empty.
- The store is machine-local (`.paqad/vectors/`, gitignored) and written
  atomically so a reader never sees a half-written cache.

## Triggers & Side Effects

- Reads/writes `.paqad/vectors/embedding-cache.json` during index build/sync.

## Error States

- Missing or corrupt cache file → treated as empty; rebuilt on the next flush.

## Glossary

- *content address* — the sha256 of the chunk text used as the cache key.
- *cache hit / miss* — whether a chunk's embedding is already stored.
