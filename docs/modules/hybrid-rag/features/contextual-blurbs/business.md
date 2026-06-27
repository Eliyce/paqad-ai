# Contextual Blurbs — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `contextual-blurbs`

## Overview

A bare code chunk searches poorly because it has lost the context that says what it is —
which file it lives in, the symbol it belongs to, the part of the system it serves. This
feature prepends a short, deterministic blurb with exactly that context before the chunk
is embedded and lexically indexed, which is a large, cheap retrieval-quality win with no
per-chunk AI call. The slice the model is later shown stays clean — only the search text
is enriched.

This page describes **Contextual Blurbs** from a business perspective. The technical
contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — gets noticeably better retrieval (the right slice surfaces more often)
  at no extra cost or latency.
- **paqad-ai contributor** — a deterministic, eval-gated precision lever.

## User Flows

- **Index build:** each chunk is embedded and BM25-indexed with its blurb (path,
  enclosing signature, exported symbols, module role) prepended.
- **Retrieval:** the model receives the clean slice; the blurb only ever lived in the
  search text.

## Business Rules

- Fully deterministic — no per-chunk AI call.
- The stored slice is never modified; only the embedded / indexed text is enriched.
- Turning blurbs on changes what the index holds, so the index is rebuilt cleanly rather
  than mixed (it rides the chunker version).
- A precision change is proven by the eval gate before it is trusted.

## Triggers & Side Effects

- Runs during the background index build/sync; no separate artifact.

## Error States

- A chunk with no symbols still gets at least its file path; a missing module map simply
  omits the role. Never an error.

## Glossary

- *blurb* — the short context line prepended to a chunk before search.
- *module role* — the module-map name for the chunk's file.
