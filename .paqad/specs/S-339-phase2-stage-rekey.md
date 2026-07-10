# Specification — S-339 Phase 2: stage-evidence re-key

## Behaviour

- FR-1: `stampSessionRow` / `appendStampedRowToUnit` / `readUnitFile` expose the
  session-ledger row primitives (envelope stamp, hash, validate, append-to-path,
  tolerant read) independent of the `<docType>/<session>/<ordinal>` path scheme.
- FR-2: `appendSessionEvent` and `readSessionUnit` keep identical signatures and
  behaviour (they compose the new primitives), so every existing consumer is unaffected.
- FR-3: A feature-scoped stage ledger writes/reads a change's rows at
  `.paqad/ledger/feature-evidence/<dirName>/stage-evidence.jsonl` and folds them into
  the same `FoldedChange` view, keyed by the feature dir name.
- FR-4 (2c): the recorder, live-writer, finalize, verify, the capability stages gate,
  and the workflow-state change-key anchor resolve the active feature (Phase-1
  `_session` control) instead of the session ordinal; the CLI gains
  `stage start planning --title <t> --issue <n>` and `resume --feature <ref>`.

## Acceptance criteria

- AC-1: Given a stamped row, when appended via `appendStampedRowToUnit` to a feature
  path and read via `readUnitFile`, then the round-tripped row equals the stamped row.
  (proof: automated)
- AC-2: Given the refactor, when the existing session-ledger + stage-evidence tests
  run, then all pass unchanged (public API preserved). (proof: automated)
- AC-3: Given no active feature, when a stage is recorded via the feature-scoped
  ledger, then a feature dir is minted, set active in the `_session` control, and the
  row lands in that dir's `stage-evidence.jsonl`. (proof: automated)
- AC-4: Given planning + specification recorded for the active feature, when the
  stages gate evaluates a development edit, then it allows (parity with today's
  session/ordinal gate). (proof: automated)

## Invariants

- INV-1: The stage-evidence row schema and hashing are unchanged — only the storage
  location moves.
- INV-2: The `src/stage-evidence/**` 100% coverage floor and `pnpm run ci` stay green
  at every checkpoint; the cutover is atomic (no dual-write, no half-migrated state).

## Open questions

- Q1: Untitled feature slug when planning is marked without `--title` (fallback:
  `change-<ULID>` or slug from the recent prompt) — resolved in 2c.
