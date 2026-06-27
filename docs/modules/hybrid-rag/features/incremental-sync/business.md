# Incremental Sync — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `incremental-sync`

## Overview

The index follows the working tree. On each prompt a debounced background worker
diffs the working tree against the index, re-embeds only the chunks that changed
(reusing the embedding cache so nothing already seen is re-embedded), and swaps
the refreshed index into place with up-to-date branch metadata. It never blocks
the coding path: the work is detached and single-flight-locked.

This page describes **Incremental Sync** from a business perspective. The
technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — retrieval reflects the files they just edited, without running
  any command, and a branch switch self-heals on its own.
- **paqad-ai contributor** — the background freshness mechanism the session-time
  seam reads from.

## User Flows

- **Edit then prompt:** the next prompt triggers a background sync that re-embeds
  only the edited files; the result lands on a following prompt
  (stale-while-revalidate).
- **Branch switch:** the new branch's changed files are absorbed as ordinary
  diffs; the index re-tags itself to the new branch.

## Business Rules

- Only an index that already exists is synced; an initial build stays an explicit
  `rag init` / `rebuild`.
- The sync is single-flight-locked, so concurrent triggers no-op rather than
  double-embed.
- It is best-effort background work: a failure never blocks the prompt and the
  last-good index keeps serving.

## Triggers & Side Effects

- Re-embeds changed chunks and atomic-swaps `.paqad/vectors/`; re-stamps branch
  metadata.

## Error States

- No index / rag disabled / another sync in flight → a clean no-op with a reason.

## Glossary

- *self-heal* — the index re-tagging itself to the current branch after a switch.
- *stale-while-revalidate* — serve the last-good index while a fresh one builds.
