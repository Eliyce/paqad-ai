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
  github `#45` ref to a parseable `45`; builds `feature.json` / `plan.json` /
  `review.json` records with a deterministic `content_hash` (volatile timestamps
  excluded).
- **Rigid schemas** (`schema.ts`) — framework-owned AJV validators
  (`additionalProperties: false`) so the stored bytes are script-owned, not a
  free-written hallucination surface. `specification.json` reuses the existing
  `FeatureSpec` shape.
- **Bundle integrity** (`bundle-integrity.ts`, issue #402) — the rigid-only invariant
  made checkable. `classifyBundlePath` judges whether a project-relative path sits in a
  bundle dir and whether it belongs there (the stage-end boundary uses it to reject a
  non-rigid artifact written into a bundle); `strayBundleFiles` lists what does not
  belong in a bundle dir so the exporter can flag pollution. Nothing here deletes.
- **Session control** (`session-control.ts`) — the `_session/<sessionId>.json`
  active + paused-feature stack + lane store, folding today's `.open` +
  `.pending-lane` role at feature grain (set-active pauses the prior active; resume
  pops a paused feature; mark-done clears).
- **Generic-slug back-fill** (`rename.ts`, issue #403) — a feature opened by a bare
  `paqad:stage planning start` is minted as the untitled `change-<ULID>`
  (`UNTITLED_FEATURE_TITLE` in `mint.ts`); when `plan compile` later carries a
  `title`, `backfillFeatureSlug` renames the bundle to the descriptive
  `[<issue>-]<slug>-<ULID>` — same ULID (the stable change key), issue detected from
  the title — repoints every `_session/*.json` control referencing the old name
  (active or paused, any session), and rewrites `artifact_paths` in the moved
  `stage-evidence.jsonl` with the row `content_hash` re-stamped by the script.
  Fail-safe: an already-descriptive dir, an empty/generic-deriving title, an
  existing target, or a rename error each leave the generic name in place with the
  compile still succeeding.
- **Feature-scoped stage ledger** (`stage-ledger.ts`, Phase 2 — additive) —
  `resolveActiveFeature` (mints/sets-active a feature so a stage call never lands on
  nothing), `appendFeatureStageRow` / `readFeatureStageUnit` / `foldFeature` write,
  read, and fold a change's stage evidence at `<feature-dir>/stage-evidence.jsonl`,
  reusing the session-ledger row primitives (`stampSessionRow` /
  `appendStampedRowToUnit` / `readUnitFile`) and the stage-evidence `foldRowsWithKey`
  core. Still dark — the live recorder is re-pointed onto it in the cutover.
- **Bundle enumeration** (`enumerate.ts`) — `listFeatureDirs` lists every feature dir
  under the evidence container. A leaf (paths + `readdir`, nothing else) so both
  `delivery.ts` — which re-exports it, keeping existing importers unchanged — and
  `adoption.ts` can use it without closing an import cycle.
- **Session-rotation adoption** (`adoption.ts`, issue #404) — the carry-over that keeps
  ONE change in ONE bundle when the host session id rotates mid-change (an app relaunch,
  a resumed conversation, a rotated `SE_SESSION`). The active feature is tracked per
  session, so a rotated id read a fresh control, found nothing active, and minted a
  second `change-<ULID>` — orphaning the bundle the change was already recorded in.
  `reconcileSessionControl` repoints a session's control at the single **in-flight bundle
  on the current branch** (`listAdoptableFeatures`) when its own `active` names no
  evidence — either unset, or a dir that was never materialized
  (`isBundleMaterialized`). It is wired into `resolveActiveFeature` and `currentFeature`
  so the write and read paths agree, and into the SessionStart hook so a rotation is
  carried over before the agent records anything.

  **The branch is what makes it work** (decision `D-01KXY55ZM70Y3JNDM8E0XC7WSX`). "In
  flight" on its own means real stage rows and no `kind:'close'` row
  (`listInFlightFeatures`), and that set only grows: a change that was abandoned, and a
  change shipped without a passing verdict, never get a close row either. This repo held
  13, so an "exactly one in flight" rule could never fire and adoption was dead code. A
  session id rotates *within* a change and a change is built on one branch, so the branch
  identifies the rotated session's own work — deterministically, with no clock heuristic
  and no tunable window. `openFeatureChange` stamps `branch` on the bundle's `open` row so
  it is known from row 1; `featureBranch` falls back to `delivery.json`'s branch for a
  bundle opened before the stamp existed, and a bundle with no knowable branch is never
  adopted while on one. Off a branch entirely (detached HEAD, non-git project) the scope
  cannot apply and the unscoped in-flight set stands.

  Three further limits keep it honest: it **never mints** (every name it returns
  already holds evidence on disk, which is why a read path may call it); it adopts only
  when **exactly one** bundle is in flight on the branch, since two or more is ambiguous
  and would risk attributing evidence to the wrong change; and it **repoints only** — a
  dangling pointer with nothing to adopt is left alone, because `resolveActiveFeature`
  sets a freshly minted feature active *before* its first row lands, so an unmaterialized
  pointer is often the live change (decision `D-01KXY2BDSN226DDCH9DZA1TAK6`). Paused
  features are never adopted: the session set them aside deliberately.

  Because adoption is cross-session, "this change is finished" has to live on the ledger
  rather than in one session's control — so `closeActiveFeature` now stamps a
  `kind:'close'` row when the bundle carries none (idempotent with the finalizer's own
  verdict-carrying close row, and skipped for an unmaterialized bundle, which is not in
  flight anyway).

Later phases of #339 wire the live recorder onto the feature ledger, plan/spec
compile, re-homed sub-ledgers, native git hooks, on-demand projections, and cutover
onto this base.

**HTML evidence report (issue #371)** — a human-readable projection of the bundle:

- **Renderer** (`report.ts`) — `renderFeatureReportHtml(bundle, fold, opts)` is a PURE
  function of the `exportFeatureBundle()` document plus the `foldFeature()` result. It
  returns ONE self-contained HTML page (inline styles, no `<script>`, no external
  request; CSS-only `<details>`; light/dark + print) following the house contract of
  `src/dashboard/export-packet.ts`. It imports the canonical paqad voice constants so
  the verdict words and glyphs never drift, encodes the fold's honesty tags (backstop
  idle-time, marker-only "no recorded work", failed-as-prominent-as-passed), verifies a
  feature receipt against itself (`verifyFeatureReceiptSelf`, hash-chained not signed),
  and renders a graceful plain-English note for every absent section — including a
  distinct "enterprise governance is off" note for a missing receipt / AI-BOM.
- **Writer** (`report-writer.ts`) — `writeFeatureReport` reads the bundle, folds the
  stages, renders, and atomically writes `report.html` into the bundle dir (the review
  comes from the rigid `review.json` like any other bundle file, since #402);
  `featureReportEnabled` reads
  the `feature_report` config flag; `resolveReportFeatureRef` resolves the active /
  most-recent / explicit-ref feature. Generation is wired into `runRepositoryVerification`
  (Claude / Codex / Gemini via the one backstop) and `delivery-link commit|merge` (advisory
  hosts via git hooks), and exposed as `paqad-ai feature report`. All best-effort: it never
  changes a verification verdict or a stage row. No code path opens the OS browser (issue
  #388 removed the auto-open-on-completion behaviour, the manual `--open` opener, and their
  config knob).

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
- `tests/unit/feature-evidence/adoption.test.ts` — in-flight detection, branch scoping
  (the open-row stamp, the `delivery.json` fallback, the other-branch and unknown-branch
  refusals, the non-git degrade), the repoint-only
  reconcile, the ambiguity and paused guards, the durable close row, and the end-to-end
  session-id rotation (one bundle, not two).
- `tests/unit/feature-evidence/index.test.ts` — barrel surface.
- `tests/unit/feature-evidence/report.test.ts` — the pure HTML renderer (self-containment,
  verdict, honesty tags, receipt integrity, graceful empty states, determinism).
- `tests/unit/feature-evidence/report-writer.test.ts` — bundle → report.html writer, flags,
  review rendering from `review.json`, and ref resolution.
- `tests/unit/feature-evidence/bundle-integrity.test.ts` — bundle-path classification and
  stray detection (the rigid-only invariant).
