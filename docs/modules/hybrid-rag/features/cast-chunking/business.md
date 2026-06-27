# cAST Chunking — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `cast-chunking`

## Overview

How source files are cut into the pieces the index stores and retrieves. Boundary
detection finds each symbol (function, class, method); the cAST "merge" pass then
coalesces small adjacent pieces from the same file up to a size budget, so the model
receives a coherent slice instead of a one-line fragment. The index also records which
chunking strategy built it, so a strategy change triggers a clean full rebuild rather
than silently mixing old and new pieces.

This page describes **cAST Chunking** from a business perspective. The technical
contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — gets better-formed code slices with fewer fragments, and an index that
  can't quietly corrupt itself when the chunking strategy evolves.
- **paqad-ai contributor** — a clean seam to slot in a tree-sitter parser later, gated by
  the index versioning.

## User Flows

- **Build / sync:** files are chunked (split into symbols, then small adjacent ones
  merged), and the index records the chunker version it used.
- **Strategy change:** if the chunker version changes, the index is treated as invalid
  and fully rebuilt — never partially synced with mixed strategies.

## Business Rules

- Merging never crosses a file boundary, never drops or reorders content, and leaves an
  already-large piece untouched.
- An index built by a different chunker is rebuilt from scratch, not patched.
- A precision change like this is proven by the eval gate before it is trusted; the
  parser swap to tree-sitter is a separate, eval-gated future upgrade.

## Triggers & Side Effects

- Chunking runs during the background index build/sync; the chunker version is stamped
  into the index metadata.

## Error States

- A malformed source file falls back to a safe paragraph split; chunking never throws.

## Glossary

- *cAST* — chunk-by-AST: split a file at syntax boundaries, then merge small adjacent
  pieces up to a budget.
- *chunker version* — a tag identifying the chunking strategy an index was built with.
