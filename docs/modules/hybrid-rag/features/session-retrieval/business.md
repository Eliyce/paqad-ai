# Session Retrieval — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `session-retrieval`

## Overview

This is where the built-but-unread vector index finally reaches the model. On each
prompt a background worker retrieves the handful of slices most relevant to the
files in play and writes them into the session-context artifact, right after the
rules. The seam then injects that artifact on the next prompt — so the model gets a
short, relevant slice of the codebase instead of nothing.

It sends slices, not whole files, and never blocks: the retrieval runs in the
detached background worker, and if anything is off (rag disabled, no index, weak
matches) the model simply proceeds with grep exactly as before.

This page describes **Session Retrieval** from a business perspective. The
technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — relevant context shows up in the prompt without asking, scoped to
  what they are working on, framed as hints to verify.
- **paqad-ai contributor** — the consumer that turns the index into injected
  context on the seam.

## User Flows

- **Edit then prompt:** the background worker syncs the index, retrieves slices for
  the edited files, and the slices land on a following prompt
  (stale-while-revalidate).
- **Nothing relevant:** weak or no matches inject nothing — the model uses grep.

## Business Rules

- At most a few slices are injected, each capped in size — the point is to save
  tokens, never to dump files.
- Slices are advisory: the model is told to re-read the live files before relying
  on them.
- Retrieval is driven by the files in play, not the prompt text, because the
  artifact is precomputed in the background.

## Triggers & Side Effects

- Writes the retrieval section into `.paqad/context/session-context.md` (after the
  rule slice).

## Error States

- rag disabled / no index / below the match threshold / any error → no slices, the
  artifact stays rule-only, behaviour equals today.

## Glossary

- *slice* — one retrieved chunk (a fragment of a file), not the whole file.
- *working set* — the files currently being changed, used as the retrieval query.
