# Existing-Surface Planning Digest — Business View

> Module: **Context Intelligence** (`context-intelligence`) · Layer: `framework-internals` · Feature slug: `existing-surface`

## Overview

Before the model writes a new helper, paqad shows it what already exists. On a
feature-development turn, the background context worker composes a short **`## Existing
surface`** section into the session-context the model reads next: the exported symbols
that already exist for the files and modules the change touches, each as a one-line
signature card with how many places call it. It is the single best-evidenced
anti-duplication lever — the model reuses the surface it can see instead of rebuilding
it.

This page describes **Existing-Surface Planning Digest** from a business perspective. The
technical contract lives at [`technical.md`](./technical.md); the callable surface at
[`api.md`](./api.md).

## User Roles

- **Developer** — gets a ranked "here's what already exists" cheat sheet at planning
  time, so the change calls an existing helper instead of duplicating one.
- **paqad-ai contributor** — the first live consumer of the structural repo-map, wiring a
  finished-but-unused capability into the thing developers actually see.

## User Flows

- **Reuse at planning:** the model receives the most relevant existing symbols for the
  files in play (signature, location, caller count, module) and decides what to reuse
  before writing anything new.

## Business Rules

- **Feature-development only.** The section appears only on the feature-development route
  (the only route that writes code). Questions, docs, and small talk stay token-neutral.
- **Budget-capped.** A hard token budget (default 1000, config
  `existing_surface_tokens`) bounds the spend; the highest-ranked symbols win and the
  rest are dropped with an honest "…and N more" line pointing at `paqad-ai index query`.
- **Embedding-free.** It ranks by the import graph (PageRank) and reads the
  code-knowledge index, so it works even with RAG turned off.
- **Honest signatures.** Signatures and caller counts come from the code-knowledge index
  when present; without it, cards fall back to name-only — never a fabricated signature.

## Triggers & Side Effects

- Composed by the detached background worker (`paqad-ai rag refresh-context`), never on
  the prompt path. It only writes into the session-context artifact the seam already
  injects; it adds no new files and makes no network calls.

## Error States

- Nothing implicated (no working set, no prompt match) → no section (token-neutral).
- No code-knowledge index → name-only cards from the repo-map resolvers.
- Any failure in the composer → the section is simply omitted; the worker never fails
  for it.

## Glossary

- *signature card* — one line: the symbol's signature, its file:line, how many places
  call it, and its module.
- *PageRank* — the ranking that surfaces the most structurally-central (most-imported)
  files first.
- *token budget* — the byte ceiling on the section; content past it is dropped by rank.
