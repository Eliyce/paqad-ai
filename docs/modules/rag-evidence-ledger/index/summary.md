# RAG-Evidence Ledger

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `rag-evidence-ledger`

## Purpose

A script-written, per-(session, conversation) record of what the RAG layer actually did
at runtime, built on the [session-ledger substrate](../../session-ledger/index/summary.md):

- **refreshed** — the background index / rule-context build or incremental sync ran.
- **called** — a retrieval query was issued (scope / top-n / candidate pool).
- **used** — what the background worker actually DELIVERED into the session-context
  artifact the prompt seam injects: which sections (`rules` / `retrieval` / `memory` /
  `drift`), the slice or context-pack-pointer count, the top match score, and the bytes.
  `injected` is `true` only when the RAG tier contributed content, so this row is the
  guardrail for "was retrieval actually used?", not just "did retrieval run?".
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

## Why the code works the way it does

- **`audit-bridge.ts`.** `.paqad/audit.log` is shared by many subsystems, so the flat RAG line is
  kept for compatibility and a structured row is written as well. These are engine events (build,
  sync, fallback), so they carry the adapter `engine`. An event with no structured equivalent
  stays in the flat log only, and a failed mapping is silent because the flat line already landed.
- **Two homes.** A row lives in the session's `_chat/<session>/rag.jsonl` for chat turns or in a
  feature bundle's `rag.jsonl` for feature turns; the conversation ordinal is always allocated in
  the `_chat` home. The fold unions both homes for the session and groups by ordinal, so order
  does not matter. A background event with no open conversation opens one first, so it records
  the same `open` row then data row as a prompt turn.
- **`schema.ts`.** The schema lives in `src/`, never under `.paqad/`, so the model can never
  weaken it.
- **`session.ts`.** `persistLedgerSessionId` writes the live host session id to the cache at
  session start without minting. Otherwise a shell `paqad-ai stage start` run before the first
  edit could read an earlier session's id and mint its bundle under it, while the edit gate keys on
  the real host id, which orphans the bundle and blocks the edit. A host id passed to
  `resolveSessionId` is also cached, so a later reader with no hint resolves the same id, matching
  the hooks' own resolver. Cache writes are best-effort.

- **`runtime/scripts/rag-evidence-record.mjs`.** The prompt seam runs from the global hook install,
  which may have no compiled `dist`, so this small writer produces rows in exactly the format
  `src/rag-ledger/fold.ts` reads and `src/rag-ledger/schema.ts` validates, with the same identity
  hash exclusions as `src/session-ledger/ledger.ts`. A cross-format test keeps the two in step. It
  mirrors `resolveRagHome`, `mirrorRagRow`, `chatDir` and `featureChangeKey`: a row bound for a
  feature bundle carries the bundle envelope header (no `adapter`, since the host lives in
  `feature.json`), and the `_chat` home keeps the rag-evidence envelope. Any read failure falls
  back to the `_chat` home so a row is never lost. The ordinal is allocated by exclusive create,
  so it is race-safe with the background worker and the TS recorder. A host session id is cached
  so the background worker aligns with it, and a minted id uses crypto randomness, since id minting
  is treated as a security context. Recording is silent and never breaks a prompt turn.

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
