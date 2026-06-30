# Session-Scoped Evidence Substrate

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `session-ledger`

## Purpose

The reusable, script-written, session-scoped, append-only JSONL evidence primitive
(issue #249 P0). It owns the layout `.paqad/ledger/<docType>/<session>/<ordinal>.jsonl`
and provides:

- **atomic ordinal allocation** via exclusive-create (`wx`) retry, so the background
  worker and the prompt seam never share an ordinal;
- an **`.open` pointer** to the current ordinal;
- a **script-clock `ts`** and an identity **`content_hash`** (excludes `ts`/`content_hash`/
  `note`) stamped on every row;
- a **tolerant reader** that skips malformed lines so a mid-crash write never poisons reads;
- an **injectable per-row validator** (the consumer plugs its AJV schema).

The RAG-evidence ledger (#249) and the stage-evidence ledger (#247) both consume this
one primitive instead of duplicating it. It imports no enterprise code, so it is
always-on and independent of any AI-BOM / enterprise flag.

The **disabled-session audit** (buildout F2b, decision D1) also rides this substrate
under the `disabled-session` doc type: when a session completes while paqad is
disabled, `recordDisabledSession` (in `src/session-ledger/disabled-audit.ts`) writes
ONE row so the bypass is visible in the dashboard / SIEM. It is recorded by
`verify-backstop.mjs`'s disabled branch (best-effort, lazy `dist` import, only for the
`hook-completion` origin) — the enforcement contract (no gates when disabled) is
untouched; the audit is a hook-layer concern, so the `runRepositoryVerification` API
stays a pure no-op when disabled.

## Source Footprint

- `src/session-ledger`

## Features

_This module is the unit of work; its API (`openSessionDoc` / `appendSessionEvent` /
`readSessionDoc` / `foldByOrdinal` / `allocateOrdinal` / `sessionLedgerPath`) is the
shared substrate._

## Authority

The single source of truth for this module's identity, slug, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins**.

## Tests

- `tests/unit/session-ledger/ledger.test.ts`
- `tests/unit/session-ledger/disabled-audit.test.ts` — the F2b disabled-session
  audit row (records once per session, idempotent, best-effort).
