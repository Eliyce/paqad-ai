# Session-Scoped Evidence Substrate

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `session-ledger`

## Purpose

The reusable, script-written, session-scoped, append-only JSONL evidence primitive.
It owns the layout `.paqad/ledger/<docType>/<session>/<ordinal>.jsonl`
and provides:

- **atomic ordinal allocation** via exclusive-create (`wx`) retry, so the background
  worker and the prompt seam never share an ordinal;
- an **`.open` pointer** to the current ordinal, which `closeSessionOrdinal` resets to
  `0` so the next allocation opens a FRESH ordinal (a passing change closes,
  the next change gets its own unit and never free-rides on the previous one);
- a **script-clock `ts`** and an identity **`content_hash`** (excludes `ts`/`content_hash`/
  `note`) stamped on every row;
- a **tolerant reader** that skips malformed lines so a mid-crash write never poisons reads;
- an **injectable per-row validator** (the consumer plugs its AJV schema).

The RAG-evidence ledger and the stage-evidence ledger both consume this
one primitive instead of duplicating it. It imports no enterprise code, so it is
always-on and independent of any AI-BOM / enterprise flag.

The **disabled-session audit** (buildout F2b, decision D1) also rides this substrate
under the `disabled-session` doc type: when a session completes while paqad is
disabled, `recordDisabledSession` (in `src/session-ledger/disabled-audit.ts`) writes
ONE row so the bypass is visible in the dashboard / SIEM. It is recorded by
`verify-backstop.mjs`'s disabled branch (best-effort, lazy `dist` import, only for the
`hook-completion` origin) — the enforcement contract (no gates when disabled) is
untouched; the audit is a hook-layer concern, so the `runRepositoryVerification` API
stays a pure no-op when disabled. A disabled project also never takes the Stop hook's
background-stage step-aside in `runtime/hooks/verification-completion.mjs`, so
this audit row is the only thing a disabled Stop writes, with no `completion-deferred` row.

## Why the code works the way it does

- **`ledger.ts`.** Closing a unit writes `0` to the `.open` pointer instead of deleting it, which
  keeps `currentOrdinal` simple and avoids a missing-file race; the unit's rows stay on disk.
  `recorded_at`, the time field on evidence-bundle rows, is left out of the identity hash the same
  way `ts` is, so rows written before it existed hash the same. A row is readable with either time
  field, so old and new rows can share one file. `stampSessionRow` and `appendStampedRowToUnit` exist so
  the per-feature stage ledger, which keeps `stage-evidence.jsonl` inside the bundle, reuses the
  same stamping and validation without the session and ordinal path.
- **`non-feature-skip-audit.ts`.** It mirrors the disabled-session audit: one best-effort row per
  session when the completion backstop skips verification. The row carries the routed workflow
  and why it skipped: `not-owner` (the session owns no change), `detour` (an owner on a
  non-feature turn that edited nothing), or the default `non-feature-route`.
- **`project-ledger.ts`.** Some stores are project snapshots (delivery detection, rule compliance)
  rather than per-conversation records. They ride the same substrate under a sentinel "session",
  one row per producer run, and the latest matching row is the current state. Writes are
  best-effort so recording never breaks the producer.

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
