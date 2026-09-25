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
- **feature.json writer** (`feature-record.ts`, issue #511) — the missing writer for the
  `feature.json` schema #339 shipped dark. `seedFeatureRecord` writes it when a feature is
  opened (idempotent); `updateFeatureRecord` patches it on rename / lane / spec-freeze /
  close, re-stamping the `content_hash`. `featureRecordIsUntitled` is the placeholder check
  the completeness gate uses (title `change` + no ticket ⇒ the change has no record of what
  it was). Since #581 it is also the only home of the session constants `adapter`,
  `branch`, `base_branch` and `lane`: set when the change opens and updated in place by
  `recordChangeConstants` (the latest host wins; the completion backstop never replaces the
  host, and an unresolved lane never erases a recorded one). Stage rows (schema version 2)
  no longer carry them. `readChangeConstants` reads `feature.json` first and falls back, field
  by field, to the `open` row of a bundle written before #581.
- **Document headers** (`envelope.ts`, `bundle-document.ts`, issue #581) — every JSON
  document in a bundle opens with the same six fields, in this order: `schema_version`,
  `doc_type` (`paqad.<file-stem>`), `change` (the folder-name ULID), `session_id`,
  `recorded_at` and `content_hash`. `mint.ts` builds `feature.json`, `plan.json` and
  `review.json` through `buildDocumentEnvelope`; `delivery.json`, `rules-loaded.json`,
  `checks.json` and `visual-evidence.json` go through `stampFeatureDocument`, which stamps
  the writer session when it has one and otherwise the session that opened the change (a git
  hook has none). `recorded_at` replaces `created_at`, `captured_at` and `generated_at`,
  including on each visual-evidence step. `feature.json` is the only file with `issue`,
  `title` and `slug` (`ulid` became `change`, `session_first_seen` became `session_id`,
  and it keeps `updated_at`); `plan.json` and `review.json` no longer repeat them, and the
  report reads the title from `feature.json`. `delivery.json` no longer holds the branch:
  branch matching and `delivery-link` read and record it on `feature.json`, falling back to
  the `branch` an old `delivery.json` carried. `rules-loaded.json` no longer holds the
  `adapter`. The changed shapes are schema version 2 (`checks.json` 3); each AJV schema is
  the envelope fragment composed through `allOf` with its own body, and a
  `schema_version: 1` file is checked against its old shape, so an old bundle still reads.
  `readFeatureRecord` maps an old `feature.json` onto the new names, and its next patch
  rewrites it in the new shape.
- **Bundle manifest** (`manifest.ts`, issue #511) — the single declarative source of truth
  for **which** bundle files a feature-development change must leave, **when** each is
  required, and **who** writes it. The `bundle-completeness` gate reads it, and a test
  asserts it covers every `FEATURE_BUNDLE_FILES` key plus `report.html`, so a file added in
  a future phase cannot ship without declaring its expectation.

### Bundle files and when each is expected (the manifest)

| File | Expected when | Writer |
| --- | --- | --- |
| `feature.json` | always | feature mint (`stage start` / `plan compile`) |
| `plan.json` | always | `paqad-ai plan compile` |
| `specification.json` | always | `paqad-ai spec freeze` |
| `review.json` | always | `paqad-ai review record` |
| `stage-evidence.jsonl` | always | stage recorder |
| `delivery.json` | always | feature open + `paqad-ai delivery-link` |
| `rules-loaded.json` | checked-when-present (issue #557) | `paqad-ai rules load` |
| `rule-run.jsonl` | `rule_compliance != off` | rule-scripts runner |
| `change-metrics.jsonl` | `metrics_enabled` | change-metrics collector |
| `duplication.jsonl` | `duplication_mode != off` | duplication scan |
| `report.html` | `feature_report` | feature report renderer |
| `rag.jsonl` | `rag_enabled` | RAG recorder (bundle or `_chat`) |
| `receipt.json` | `enterprise` + `evidence_ledger` | `projectFeatureReceipt` |
| `evidence.jsonl` | always (issue #581) | `appendFeatureEvidenceRows` |
| `ai-bom.json` | `enterprise` + `ai_bom` | `projectFeatureReceipt` (AI-BOM) |

The **`bundle-completeness` gate** (`src/verification/repository/bundle-completeness-gate.ts`)
runs last at end-of-change (after every writer). Under `bundle_completeness=strict` (the
default) a required-but-missing/empty/invalid file **fails** the change (Needs your
attention), naming the file and its writer, and blocks via the Stop-hook path; `warn`
surfaces it as Inconclusive; `off` falls back to the deprecated (warn-only)
`evidence_existence_gate`. A file recovered by cache backfill is reported `backfilled`
(never a clean pass); a RAG gap is unrecoverable and reads Inconclusive; a flag-off file is
`skipped`. No-active-bundle and non-local (CI) turns skip the gate entirely, and so does
any turn the session-ownership check skips (see below).
- **Session ownership at turn end** (`src/pipeline/session-ownership.ts`, issue #582) —
  `classifyCompletionEnforcement` decides whether this session's turn is checked at all.
  A session owns a change when an unclosed bundle holds a stage row with its own session id
  written by the agent (`evidence_source` `live-mark` or `redo`); hook-inferred rows never
  count. No owned rows skips the turn (`not-owner`). An owner that wrote a row since the
  turn's `turn_started_at` stamp (in the per-session workflow-state) is checked; an owner
  on a non-feature route with no row this turn is skipped (`detour`). CLI stage rows carry
  `session_source` (`host` / `env` / `cache`), and a `cache` row never counts as this
  turn's edit, since the shared cache file may name another live session. The check only
  reads bundles; it never repoints a session's active feature.
- **Rule-loading gate** (`rules-loaded-gate.ts`, issue #557) — the completion-seam backstop
  that a feature-development change actually LOADED its applicable rules, not just that the
  ceremony ran. `paqad-ai rules load` computes the applicable rules deterministically
  (reusing `computeRuleApplicability`), prints their full text, and writes `rules-loaded.json`
  (the applicable rule ids, per-rule matched paths, and a content hash of the loaded text).
  The edit-time `rules-loaded` kernel capability blocks the first feature-dev source edit
  until that record exists; this gate **fails** a feature-dev code change with no record
  (blocks like a missing plan/spec), reads **inconclusive** when the load is stale (a rule
  became applicable after it ran), and is **skipped** with no compiled rules / no applicable
  rule / a non-feature change. It attests loading and acknowledgment, never comprehension.
- **Plan reuse gate** (`reuse.ts`, issue #357, Phase A) — the plan must answer "did you
  check what already exists?" before it compiles. `validateReuseSection` returns blocking
  `errors` and non-blocking `warnings` for the template's `reuse` section: `consulted`
  (≥1 entry — what was actually checked), `reusing` (may be empty), and `new_constructs`
  (every new exported construct, justified). `writeFeaturePlan` runs it BEFORE resolving
  the active feature, so a plan that has not answered leaves no trace at all — no bundle
  rename, no file. Checks are deterministic and cost zero model tokens: first-party
  `reusing[].symbol` entries are looked up in the code-knowledge index (an unknown symbol
  fails with a nearest match, reusing the exported `levenshtein` rather than a second
  edit-distance implementation); a framework-native claim (one with `package`) must set
  `version` and match the resolved `locked_version` in `.paqad/stack-snapshot.json`; and
  when `stack_profile.frameworks` is non-empty, a new construct must carry
  `framework_checked` or a justification naming the framework. Fail-safe throughout — an
  absent index or snapshot downgrades to a warning, and a framework-less project carries
  no new burden. `CREATE_KEYWORDS` is one exported constant so the declare-or-justify
  trigger list stays tunable. `reuse` is REQUIRED on the compile input but OPTIONAL in
  the stored `PLAN_SCHEMA`, so a `plan.json` written before this gate stays valid.
  Phase B (issue #397) adds the verification the declaration alone could not give:
  `verifyFrameworkSymbols` looks every `reusing[]` entry with a `package` up in the
  installed framework-API index (`src/framework-api/`, see
  [framework-api](../../framework-api/index/summary.md)) and returns the COMPUTED
  provenance in `ReuseValidation.provenance`, which `writeFeaturePlan` applies to the
  plan it stores — so `provenance` in a `plan.json` is a checked fact, not a model
  assertion. Only two verdicts block: `absent` (fails with the nearest existing symbol)
  and `deprecated` (fails citing the tag's message, `since`, and whether it is slated for
  removal). `unknown-dynamic` and an unindexed package warn, and an absent index warns
  with `FRAMEWORK_API_INDEX_ABSENT_WARNING` — a project that never built the index is
  never gated on one. Phase C's non-JS ecosystem adapters are #398.
- **Plan step files** (issue #579): a plan step may list the `files` it expects to touch
  (project-relative, posix). The field is optional and additive in `PLAN_SCHEMA`, so an older
  `plan.json` stays valid. `plan compile` and `spec freeze` union those files with the
  git-reconciled changed files to tell a frontend change apart before any code exists, which
  drives the visual-evidence readiness pause and the `(proof: visual)` freeze requirement
  (see [visual-evidence](../../visual-evidence/index/summary.md)).
- **Visual evidence in the bundle** (issue #551, #579): `visual-evidence.json` plus the
  `screenshots/` subtree are written only by `paqad-ai visual-evidence run` and
  `paqad-ai visual-evidence attach`, through one manifest writer. The manifest's optional
  `source` reads `agent-attached` or `mixed` when the agent attached screenshots, and attached
  steps carry `journey_id: agent-attached` (plus an optional `ac`), so they are never shown as
  scripted captures.
- **Bundle integrity** (`bundle-integrity.ts`, issue #402) — the rigid-only invariant
  made checkable. `classifyBundlePath` judges whether a project-relative path sits in a
  bundle dir and whether it belongs there (the stage-end boundary uses it to reject a
  non-rigid artifact written into a bundle); `strayBundleFiles` lists what does not
  belong in a bundle dir so the exporter can flag pollution. Nothing here deletes.
- **Session control** (`session-control.ts`) — the `_session/<sessionId>.json`
  active + paused-feature stack + lane store, folding today's `.open` +
  `.pending-lane` role at feature grain (set-active pauses the prior active; resume
  pops a paused feature; mark-done clears). `setActiveFeature` is the only writer that
  replaces `active`, and it always pushes the outgoing ref onto `paused[]`, so switching
  a session's change can never drop the one it was on — every caller that redirects a
  session goes through it for that reason.
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
  reusing the session-ledger row primitives (`appendStampedRowToUnit` / `readUnitFile`)
  and the stage-evidence `foldRowsWithKey` core. Since #581 each row is stamped by the
  envelope's `stampBundleRow`: the six-field header (`schema_version` 2, `doc_type`
  `paqad.stage-evidence`, `change` = the folder-name ULID from `featureChangeKey`,
  `session_id`, `recorded_at`, `content_hash`) and then the row's own fields. `ts` and the
  retired `conversation_ordinal` are no longer written; readers take the time through
  `rowRecordedAt`, so a bundle written before #581 still folds. Session ledgers outside a
  bundle keep `ts`.

  `resolveFeatureRef` / `resumeFeatureByRef` are the readers behind
  `paqad-ai resume --feature <ref>`. A ref resolves against the **session control first**
  (active, then the paused stack, most-recently-paused first) and then against the
  **bundles recorded on disk** (issue #540) — each tier matched exactly on dir name, ULID
  or issue before either falls back to a slug substring, so a precise ref never loses to a
  loose match. The on-disk tier exists because the control is not the whole record:
  `markDone` drops a finished change from it, and a session-id rotation leaves a bundle in
  a control this session never reads, so a control-only lookup made recorded evidence
  unreachable through every supported command and left hand-editing
  `_session/<id>.json` as the only recovery. Resuming a bundle from the on-disk tier goes
  through `setActiveFeature`, so the change the session was on is paused rather than
  dropped. Neither reader mints.
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
  and no tunable window. `openFeatureChange` records `branch` on `feature.json` at open
  (a bundle written before #581 stamped it on its `open` row, which is still read) so it is
  known from the start; `featureBranch` falls back to `delivery.json`'s branch for a
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

  That close row is also what stops a FINISHED change being re-opened as a phantom
  (issue #540). `sessionClosedAnyFeature(projectRoot, sessionId)` is true when any bundle
  carries a close row stamped with this session id — the one signal that tells a replayed
  transcript from a change genuinely starting. Both retrospective seams consult it when
  nothing is active: the marker parser (`src/stage-evidence/marker-parse.ts`) re-reads the
  whole transcript on every turn, and the git backstop (`src/stage-evidence/finalize.ts`)
  re-reads the whole branch delta, so once the session pointer was released each of them
  opened a fresh untitled `change-<ULID>` for work that was already done — stealing the
  pointer and verifying the phantom as `incomplete`, which reported a green change red. A
  background `<task-notification>` produces exactly such a turn, so ordinary CI watching
  triggered it.

  The scope is **session-level, not branch-level** (decision
  `D-01M269DKJ3PNEGGXH3HGZMFTFY`), so a session's FIRST change keeps the existing
  auto-open behaviour on every host — including the Codex and Gemini completion hooks that
  share both seams and have no PreToolUse writer. Its known limit is a session-id rotation
  *after* a close: the close row names the old session, and unlike a change still in flight
  there is nothing left for adoption to carry. Branch scoping would cover that, but it
  stops the marker seam opening a bundle on any long-lived branch and would not have caught
  the second phantom observed on `main`.

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
- `tests/unit/feature-evidence/stage-ledger.test.ts` — feature-scoped stage ledger, plus
  ref resolution across both tiers (a released bundle, a rotated session, control-wins
  precedence) and the paused-on-resume guarantee.
- `tests/unit/feature-evidence/adoption.test.ts` — in-flight detection, branch scoping
  (the open-row stamp, the `delivery.json` fallback, the other-branch and unknown-branch
  refusals, the non-git degrade), the repoint-only
  reconcile, the ambiguity and paused guards, the durable close row, the end-to-end
  session-id rotation (one bundle, not two), and `sessionClosedAnyFeature`'s
  session-level attribution.
- `tests/unit/stage-evidence/notification-displacement.test.ts` — the issue #540
  displacement path end to end: a completed change closed, then the turn a background
  notification produces, asserting no bundle is minted, no row lands in the finished
  bundle, no failing verdict is reached, the change stays resumable, and the first-change
  and other-session paths still open exactly as before.
- `tests/unit/feature-evidence/index.test.ts` — barrel surface.
- `tests/unit/feature-evidence/report.test.ts` — the pure HTML renderer (self-containment,
  verdict, honesty tags, receipt integrity, graceful empty states, determinism).
- `tests/unit/feature-evidence/report-writer.test.ts` — bundle → report.html writer, flags,
  review rendering from `review.json`, and ref resolution.
- `tests/unit/feature-evidence/bundle-integrity.test.ts` — bundle-path classification and
  stray detection (the rigid-only invariant).
