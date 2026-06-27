# Trigger-Load — Business View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `trigger-load`

## Overview

Instead of loading the full text of every rule every session, the rule context
loads the full text of only the rules that apply to the files in play: the
always-load rules (those with a `**` trigger or no trigger at all) plus the
scoped rules whose declared trigger patterns match the working-set files.
Non-matching scoped rules stay on the manifest line but their text is not loaded.
This is the bulk of the rule-token cut, and it is deterministic — a declared
trigger match, never an embedding-RAG guess, because omitting a rule that applies
is a correctness failure.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — gets exactly the rule text relevant to what they are touching.
- **paqad-ai contributor** — relies on always-load rules never being dropped and
  scoped rules loading the moment a matching file is in play.

## User Flows

- **Touch a file, get its rules:** when a changed file matches a scoped rule's
  trigger, that rule's full text is composed into the context on the next prompt.
- **Always-on rules:** `**` / untriggered rules load every time, regardless of the
  working set.
- **Background refresh:** each prompt fires a debounced, detached refresh so the
  rule context tracks the working set without blocking; the refresh lands on the
  next prompt (the manifest covers the current one).

## Business Rules

- Always-load rules load regardless of the files in play.
- A scoped rule loads only when a changed path matches one of its triggers.
- When nothing applies, the context drops to manifest-only (the token floor).
- The refresh is single-flight-locked and atomic-swapped: never partial, never
  two refreshes clobbering each other, never blocking the prompt.

## Triggers & Side Effects

- Recomposes and atomic-writes the seam artifact `.paqad/context/session-context.md`.
- Stamps a debounce marker under `.paqad/locks/`.

## Error States

- No compiled rules → nothing composed (today's full-load fallback remains).
- `paqad-ai` not resolvable (e.g. a dev tree) → the detached refresh is skipped
  silently; the last-good artifact still serves.

## Glossary

- *working set / files in play* — the changed files from the session tracker or git status.
- *always-load* — a rule with a `**` trigger or none; applies to every change.
- *stale-while-revalidate* — serve the last-good context while a fresh one builds.
