# Review — Issue #339 Phase 2a/2b (additive foundation for the re-key)

Self-review of the committed checkpoints (session-ledger primitive extraction +
feature-scoped stage ledger + fold refactor).

## Correctness

- **Substrate extraction (2a) is behaviour-preserving.** `appendSessionEvent` now
  composes `stampSessionRow` + `appendStampedRowToUnit(sessionLedgerPath(...))` — the
  same bytes to the same path. `readSessionUnit` unchanged. Verified: all 24
  session-ledger tests + the full 6662-test suite pass. `dirname` added to the path
  import; `absDir` still used by `allocateOrdinal`/`readSessionDoc`.
- **Fold refactor (2b) is behaviour-preserving.** `foldRows` now delegates to
  `foldRowsWithKey({ sessionId, changeKey: changeKey(sessionId, ordinal),
  promptOrdinal: ordinal })` — identical output; `foldChange` unchanged. The
  `src/stage-evidence/**` 100% coverage floor holds.
- **Feature stage ledger (2b) is dark.** Nothing imports it outside its own tests, so
  the live recorder/gate are untouched. `resolveActiveFeature` mints an untitled
  `change-<ULID>` when none is active (never lands on nothing), and a titled call
  switches (pausing the prior active) — matching the Phase-1 control semantics.

## Honesty notes carried forward to the cutover (2c)

- `appendFeatureStageRow` stamps a constant `conversation_ordinal: 1` because the
  stage-evidence schema still requires it; the feature dir name is the real change
  key. The schema relocation (drop/loosen `conversation_ordinal`) is a 2c task —
  flagged, not hidden.
- The cutover must make the capability stages gate resolve the active feature
  **read-only** (it must never mint a feature just by evaluating an edit).

## Regression / rollback risk

- **None to committed behaviour** — 2a is a pure refactor, 2b is additive/dark. Full
  `pnpm run ci` green (681 files, 6662 tests, build). Rollback = revert the two
  commits.
