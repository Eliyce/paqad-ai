# RAG-Evidence Ledger

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `rag-evidence-ledger`

## Purpose

A script-written, per-(session, conversation) record of what the RAG layer actually did
at runtime (issue #249), built on the [session-ledger substrate](../../session-ledger/index/summary.md):

- **refreshed** — the background index / rule-context build or incremental sync ran.
- **called** — a retrieval query was issued (scope / top-n / candidate pool).
- **used** — what the background worker actually DELIVERED into the session-context
  artifact the prompt seam injects: which sections (`rules` / `retrieval` / `memory` /
  `drift`), the slice or context-pack-pointer count, the top match score, and the bytes.
  `injected` is `true` only when the RAG tier contributed content, so this row is the
  guardrail for "was retrieval actually used?", not just "did retrieval run?" (issue #354).
- **fallback** — RAG produced nothing and the agent used grep (with a reason).

The events fire from their real seams: `refreshed` / `called` / `used` from the background
context worker (`paqad-ai rag refresh-context`) as it syncs the index, retrieves, and
composes the artifact; `fallback` from the retrieval layer via `appendRagAudit`, which
dual-writes its RAG events into the structured ledger so it becomes the queryable source of
truth without losing any event. The LLM never hand-authors a row.

`paqad-ai rag-evidence show --session <id>` folds a session into a use-rate / fallback /
coverage rollup in the paqad voice (only `used` rows with `injected: true` count toward the
use-rate, so an honest dark turn never inflates it).

## Honest guarantee

The ledger proves a recorder script ran for a named event at a wall-clock time with the
counts it observed — **proof of occurrence, never proof of benefit**. It records that a
slice was injected, not that the model used it; "accuracy" is a correlation with the F15
eval, never a per-answer causal claim.

## Source Footprint

- `src/rag-ledger`
- `runtime/scripts/rag-evidence-record.mjs`

## Features

- **Recorder + AJV schema** — `src/rag-ledger/recorder.ts`, `schema.ts`, `types.ts`
- **appendRagAudit bridge** — `src/rag-ledger/audit-bridge.ts`
- **rag-evidence show (fold)** — `src/rag-ledger/fold.ts`, `src/cli/commands/rag-evidence.ts`

## Authority

The single source of truth for this module's identity, slug, feature names, and source
paths is [`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins**.

## Tests

- `tests/unit/rag-ledger/*.test.ts`, `tests/unit/cli/rag-evidence.test.ts`,
  `tests/unit/runtime/rag-evidence-record.test.ts`
