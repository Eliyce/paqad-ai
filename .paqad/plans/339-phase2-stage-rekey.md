# Plan — Issue #339 Phase 2: re-key stage-evidence onto the feature dir

## Goal

Move a change's stage-evidence from `.paqad/ledger/paqad.stage-evidence/<session>/<ordinal>.jsonl`
into the per-feature bundle `.paqad/ledger/feature-evidence/<dirName>/stage-evidence.jsonl`,
keyed by the active feature (Phase-1 `_session` control), while keeping the
stage-evidence public API stable so the runtime hooks + gate keep working.

## Approach — safe green checkpoints (never a half-cutover)

- **2a (additive, dark):** extract the session-ledger row primitives
  (`stampSessionRow`, `appendStampedRowToUnit`, `readUnitFile`) so a consumer keyed on
  the feature path reuses identical stamping/validation/tolerant-read.
  `appendSessionEvent`/`readSessionUnit` become thin wrappers — public API unchanged.
- **2b (additive, dark):** a feature-scoped stage-evidence location resolver +
  read/append/fold-by-feature in `src/feature-evidence/stage-ledger.ts`, built on 2a +
  the Phase-1 session control. Mints/sets-active a feature; a stage call never lands on
  nothing. Fully unit-tested, wired to nothing.
- **2c (cutover):** flip recorder / live-writer / finalize / verify / fold / narration /
  the capability stages gate / workflow-state anchor to resolve the feature location;
  add CLI `stage start planning --title/--issue` + `resume`. Update all consuming tests
  together. Hard cutover — no dual-write.

Each checkpoint keeps `pnpm run ci` green. The `src/stage-evidence/**` 100% floor holds.

## Steps

1. 2a: refactor `src/session-ledger/ledger.ts` (extract primitives) + tests.
2. 2b: `src/feature-evidence/stage-ledger.ts` (location resolve + read/append/fold) + tests.
3. 2c: re-point recorder/live-writer/finalize/verify/fold + gate + workflow-state; CLI verbs; migrate tests.
4. Full CI green; changeset already covers #339 (extend note).
