# Per-Feature Evidence Bundle

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `feature-evidence`

## Purpose

The per-feature evidence bundle (issue #339). The design: each feature gets **one
directory** — `.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/` — that is its
whole workflow record plus its compliance bundle (plan, spec, stage evidence, rule
run, delivery/git linkage, receipt, AI-BOM slice, and the retrieval that served it),
all rigid, script-owned JSON, captured the same way on every provider and traceable
to the commits that shipped it. Non-feature activity lives in a separate `_chat/`
home; whole-project compliance views are projected from these bundles on export.

**Phase 1 (this module today) is the dark, unwired foundation** — no behaviour
change, so the live feature-development stage spine is untouched:

- **Path layer** (`paths.ts`) — resolves the one-dir-per-feature layout, the
  `_session` control path, and the `_chat` home; round-trips a feature dir name to
  its `{ issue, slug, ulid }` parts (the dir name is the immutable change key). The
  container inherits the git-ignored `ledger/` root.
- **Dir-name mint** (`mint.ts`) — mints the change key from a title + optional
  ticket ref (reusing `deriveSlug`, `detectTicketRefs`, `ulid`), normalising a
  github `#45` ref to a parseable `45`; builds `feature.json` / `plan.json` records
  with a deterministic `content_hash` (volatile timestamps excluded).
- **Rigid schemas** (`schema.ts`) — framework-owned AJV validators
  (`additionalProperties: false`) so the stored bytes are script-owned, not a
  free-written hallucination surface. `specification.json` reuses the existing
  `FeatureSpec` shape.
- **Session control** (`session-control.ts`) — the `_session/<sessionId>.json`
  active + paused-feature stack + lane store, folding today's `.open` +
  `.pending-lane` role at feature grain (set-active pauses the prior active; resume
  pops a paused feature; mark-done clears).
- **Feature-scoped stage ledger** (`stage-ledger.ts`, Phase 2 — additive) —
  `resolveActiveFeature` (mints/sets-active a feature so a stage call never lands on
  nothing), `appendFeatureStageRow` / `readFeatureStageUnit` / `foldFeature` write,
  read, and fold a change's stage evidence at `<feature-dir>/stage-evidence.jsonl`,
  reusing the session-ledger row primitives (`stampSessionRow` /
  `appendStampedRowToUnit` / `readUnitFile`) and the stage-evidence `foldRowsWithKey`
  core. Still dark — the live recorder is re-pointed onto it in the cutover.

Later phases of #339 wire the live recorder onto the feature ledger, plan/spec
compile, re-homed sub-ledgers, native git hooks, on-demand projections, and cutover
onto this base.

## Source Footprint

- `src/feature-evidence`

## Authority

The single source of truth for this module's identity, slug, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins**.

## Tests

- `tests/unit/feature-evidence/paths.test.ts` — the path layer + dir-name round-trip.
- `tests/unit/feature-evidence/mint.test.ts` — dir-name mint + record builders + hash.
- `tests/unit/feature-evidence/schema.test.ts` — AJV validation (unknown-key rejection).
- `tests/unit/feature-evidence/session-control.test.ts` — active + paused control.
- `tests/unit/feature-evidence/stage-ledger.test.ts` — feature-scoped stage ledger.
- `tests/unit/feature-evidence/index.test.ts` — barrel surface.
