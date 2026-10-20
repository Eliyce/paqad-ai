# Per-Feature Evidence Bundle

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `feature-evidence`

## Purpose

The per-feature evidence bundle. The design: each feature gets **one
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
  github `#<n>` ref to a parseable `<n>`; builds `feature.json` / `plan.json` /
  `review.json` records with a deterministic `content_hash` (volatile timestamps
  excluded).
- **Rigid schemas** (`schema.ts`) — framework-owned AJV validators
  (`additionalProperties: false`) so the stored bytes are script-owned, not a
  free-written hallucination surface. `specification.json` reuses the existing
  `FeatureSpec` shape.
- **feature.json writer** (`feature-record.ts`) — the missing writer for the
  `feature.json` schema that first shipped dark. `seedFeatureRecord` writes it when a feature is
  opened (idempotent); `updateFeatureRecord` patches it on rename / lane / spec-freeze /
  close, re-stamping the `content_hash`. `featureRecordIsUntitled` is the placeholder check
  the completeness gate uses (title `change` + no ticket ⇒ the change has no record of what
  it was). It is also the only home of the session constants `adapter`,
  `branch`, `base_branch` and `lane`: set when the change opens and updated in place by
  `recordChangeConstants` (the latest host wins; the completion backstop never replaces the
  host, and an unresolved lane never erases a recorded one). Stage rows (schema version 2)
  no longer carry them. `readChangeConstants` reads `feature.json` first and falls back, field
  by field, to the `open` row of a bundle written before the one-packet change.
- **Document headers** (`envelope.ts`, `bundle-document.ts`) — every JSON
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
  Every JSONL row the bundle writes (`rule-run.jsonl`, `duplication.jsonl`,
  `change-metrics.jsonl`, `evidence.jsonl`, and `rag.jsonl`) is stamped by `stampBundleRow`
  with the same header, `doc_type` `paqad.<file-stem>` on every row of a file
  (`duplication.jsonl` was `paqad.duplication-run`; a RAG row bound for a bundle is re-stamped
  from `paqad.rag-evidence` to `paqad.rag`, both by the TS mirror and the prompt-seam
  `rag-evidence-record.mjs`), and no row carries the `adapter`. The `_chat` RAG home is not a
  bundle and keeps its own rows. `report.html` carries the header in a
  `<script type="application/json" id="paqad-header">` tag in its `<head>`, hashed over the
  page without the tag; it is inert data, and the page runs no script.
- **Bundle manifest** (`manifest.ts`) — the single declarative source of truth
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
| `spec.md` | always | `paqad-ai spec freeze` (the signed source, header in front matter) |
| `request.md` | `spec_pipeline_enabled` (on by default), graduated or full lane | `paqad-ai spec pipeline start` |
| `clarification.json` | `spec_pipeline_enabled` (on by default), graduated or full lane | `paqad-ai spec pipeline` (label + questions) |
| `experts.json` | `spec_pipeline_enabled` + `spec_pipeline_experts_enabled` (both on by default), graduated or full lane | `paqad-ai spec pipeline experts` |
| `high-table.jsonl` | checked-when-present | `paqad-ai spec pipeline experts` (record, brief, context, notes, synthesis) + SubagentStop hook |
| `cost.json` | checked-when-present | Stop and SubagentStop hooks (record-only) |
| `decisions.json` | checked-when-present | `paqad-ai decision resolve` (decisions index) |
| `tech-debt.json` | checked-when-present | `paqad-ai debt` (add, promote, close) and the end-of-change verification (the change's tech-debt index) |
| `rule-overrides.jsonl` | checked-when-present | `paqad-ai rules override` |
| `fix-proof.json` | checked-when-present | `paqad-ai fix prove` |
| `review.json` | always | `paqad-ai review record` |
| `stage-evidence.jsonl` | always | stage recorder |
| `delivery.json` | always | feature open, `paqad-ai delivery-link`, `paqad-ai deliver` and the Stop delivery check |
| `checks.json` | checked-when-present | `paqad-ai checks run` |
| `rules-loaded.json` | checked-when-present | `paqad-ai rules load` |
| `rule-run.jsonl` | `rule_compliance != off` | rule-scripts runner |
| `change-metrics.jsonl` | `metrics_enabled` | change-metrics collector |
| `duplication.jsonl` | `duplication_mode != off` | duplication scan |
| `report.html` | `feature_report` | feature report renderer |
| `rag.jsonl` | `rag_enabled` | RAG recorder (bundle or `_chat`) |
| `receipt.json` | `enterprise` + `evidence_ledger` | `projectFeatureReceipt` |
| `evidence.jsonl` | always | `appendFeatureEvidenceRows` |
| `ai-bom.json` | `enterprise` + `ai_bom` | `projectFeatureReceipt` (AI-BOM) |
| `visual-evidence.json` | checked-when-present | `paqad-ai visual-evidence run` |

A `rule-run.jsonl` findings row and a `duplication.jsonl` row keep the findings themselves, not
just their counts: each rule finding as `{rule_id, file, line, message,
severity}` and each near-copy as `{file, line_range, matched_file, matched_symbol,
matched_line_range, similarity, matched_callers, kind}`. A row keeps the first 50
(`BUNDLE_FINDINGS_CAP`) and counts the rest in `findings_overflow`, so the kept findings plus the
overflow equal the row's counts. A rule run served from the cache still writes a row, marked
`from_cache: true`. A row backfilled from a cache that has no findings list writes no `findings`
key at all, so it never reads as a clean run.

No other file belongs in a bundle. `specification.md` and `context-efficiency.jsonl` are no longer written, and the retired per-feature spec scratch folder is gone.

`paqad-ai evidence migrate [--dry-run] [--session <id>]` moves an old project's spec runs into their bundles. Update and onboarding run it too, every time the old folder is still there, and a failure there only prints a warning, so it can never stop an update. It carries over the request, the question round, the experts, one row per logged step, and one `spec-correction` row per old correction (a rerun adds none twice). Archived redo copies are dropped. `--session` names your own session (it defaults to `SE_SESSION`), so a change you have open is not mistaken for one another session is still writing; a change open in another session is skipped and migrated on a later run, once that session closes it or has been idle for a day.

The result lists every path it had to leave in the old folder as `leftBehind`: a skipped or failed run, an entry that is not a change folder, a file it does not know how to merge, or a file the OS would not let it delete. The old folder, and its line in the managed `.paqad/.gitignore`, only go once that list is empty, so nothing left in it can be committed by accident. The managed `.paqad/.gitignore` also lists `tmp/`, so the scratch inputs you hand to the record verbs never show up in git.

The **`bundle-completeness` gate** (`src/verification/repository/bundle-completeness-gate.ts`)
runs last at end-of-change (after every writer). Under `bundle_completeness=strict` (the
default) a required-but-missing/empty/invalid file **fails** the change (Needs your
attention), naming the file and its writer, and blocks via the Stop-hook path; `warn`
surfaces it as Inconclusive; `off` falls back to the deprecated (warn-only)
`evidence_existence_gate`. A file recovered by cache backfill is reported `backfilled`
(never a clean pass); a RAG gap is unrecoverable and reads Inconclusive; a flag-off file is
`skipped`. The spec-pipeline files and the strict spec-provenance check apply only on the
graduated and full lanes: the gate reads the change's recorded `lane` through
the shared `buildBundleCompletenessConfig`, an unresolved lane counts as full, and on the
fast lane the detail lists them as "not required on the fast lane". No-active-bundle and non-local (CI) turns skip the gate entirely, and so does
any turn the session-ownership check skips (see below).
- **Session ownership at turn end** (`src/pipeline/session-ownership.ts`) —
  `classifyCompletionEnforcement` decides whether this session's turn is checked at all.
  A session owns a change when an unclosed bundle holds a stage row with its own session id
  written by the agent (`evidence_source` `live-mark` or `redo`); hook-inferred rows never
  count. No owned rows skips the turn (`not-owner`). An owner that wrote a row since the
  turn's `turn_started_at` stamp (in the per-session workflow-state) is checked; an owner
  on a non-feature route with no row this turn is skipped (`detour`). CLI stage rows carry
  `session_source` (`host` / `env` / `cache`), and a `cache` row never counts as this
  turn's edit, since the shared cache file may name another live session. The work of the
  session's own stage agents counts too: in the unclosed bundle this session's
  control points at (read with `readSessionControl`), a row a `paqad-<stage>` agent wrote
  or a `stage-agent` completion row is the session's own only when it carries this
  session's id and was recorded at or after the session's last prompt (`turn_started_at`).
  A row from another session, or one written before the last prompt, is not. With no prompt
  stamp (a state file written before the stamp existed) any such row in that bundle counts,
  as before. So an orchestrator turn in which only its stage agents edited files is checked,
  not skipped, and a second session in the same checkout is never made an owner by them.
  Another session's bundle is never read this way. The check only reads bundles; it never
  repoints a session's active feature.
- **Stage-agent rows** (`src/stage-isolation/subagent-completion.ts`) — the record-only
  SubagentStop hook (`stage-agent-completion`) appends one `kind: 'stage-agent'` row
  (`kind`, `stage`, `agent`, `tokens_used`, `tokens_not_recarried`, `estimate`) when a
  `paqad-<stage>` agent finishes. The session is resolved by `resolveHookSession` in
  `src/rag-ledger/session.ts`: the payload `session_id`, then `SE_SESSION`, then
  `CLAUDE_SESSION_ID`, then the shared cache, taking the first one whose session control
  names an in-flight bundle, and otherwise the cache (minting only when nothing is known).
  The row is written into that session's bundle and stamped with the payload session id
  when the payload carries one. The hook never rewrites `.paqad/session/ledger-session-id`:
  `readLedgerSessionId` only reads it, and the marker backfill runs inside
  `keepingLedgerSessionCache`, which puts the cache back exactly as it was. The marker
  backfill reads the subagent's own `agent_transcript_path` first and takes its session
  from the payload, then `SE_SESSION`, then `CLAUDE_SESSION_ID`. The change cost and the
  High Table usage recorders resolve their session the same way. When the payload names a
  readable `agent_transcript_path` with usage, `tokens_used` is that transcript's exact
  total (input, cache read, cache write and output), `tokens_not_recarried` is estimated
  from that subagent transcript (about 4 characters per token), and the row says
  `estimate: false`, so the receipt's `context:` line reads `(exact)`. With no agent
  transcript the row keeps the earlier estimate from the parent transcript and says
  `estimate: true`.
- **Rule-loading gate** (`rules-loaded-gate.ts`) — the completion-seam backstop
  that a feature-development change actually LOADED its applicable rules, not just that the
  ceremony ran. `paqad-ai rules load` computes the applicable rules deterministically
  (reusing `computeRuleApplicability`), prints their full text, and writes `rules-loaded.json`
  (the applicable rule ids, per-rule matched paths, and a content hash of the loaded text).
  The edit-time `rules-loaded` kernel capability blocks the first feature-dev source edit
  until that record exists; this gate **fails** a feature-dev code change with no record
  (blocks like a missing plan/spec), reads **inconclusive** when the load is stale (a rule
  became applicable after it ran), and is **skipped** with no compiled rules / no applicable
  rule / a non-feature change, and skipped as not required at the `ci-backstop` origin when
  there is no record, since no session loads rules on CI. It attests loading and
  acknowledgment, never comprehension.
- **Plan reuse gate** (`reuse.ts`) — the plan must answer "did you
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
  A second check adds the verification the declaration alone could not give:
  `verifyFrameworkSymbols` looks every `reusing[]` entry with a `package` up in the
  installed framework-API index (`src/framework-api/`, see
  [framework-api](../../framework-api/index/summary.md)) and returns the COMPUTED
  provenance in `ReuseValidation.provenance`, which `writeFeaturePlan` applies to the
  plan it stores — so `provenance` in a `plan.json` is a checked fact, not a model
  assertion. Only two verdicts block: `absent` (fails with the nearest existing symbol)
  and `deprecated` (fails citing the tag's message, `since`, and whether it is slated for
  removal). `unknown-dynamic` and an unindexed package warn, and an absent index warns
  with `FRAMEWORK_API_INDEX_ABSENT_WARNING` — a project that never built the index is
  never gated on one. Non-JS ecosystem adapters are later work.
- **Plan step files**: a plan step may list the `files` it expects to touch
  (project-relative, posix). The field is optional and additive in `PLAN_SCHEMA`, so an older
  `plan.json` stays valid. `plan compile` and `spec freeze` union those files with the
  git-reported changed files to tell a frontend change apart before any code exists, which
  drives the visual-evidence readiness pause and the `(proof: visual)` freeze requirement
  (see [visual-evidence](../../visual-evidence/index/summary.md)).
- **Visual evidence in the bundle**: `visual-evidence.json` plus the
  `screenshots/` subtree are written only by `paqad-ai visual-evidence run` and
  `paqad-ai visual-evidence attach`, through one manifest writer. The manifest's optional
  `source` reads `agent-attached` or `mixed` when the agent attached screenshots, and attached
  steps carry `journey_id: agent-attached` (plus an optional `ac`), so they are never shown as
  scripted captures.
- **Bundle integrity** (`bundle-integrity.ts`) — the rigid-only invariant
  made checkable. `classifyBundlePath` judges whether a project-relative path sits in a
  bundle dir and whether it belongs there (the stage-end boundary uses it to reject a
  non-rigid artifact written into a bundle); `strayBundleFiles` lists what does not
  belong in a bundle dir so the exporter can flag pollution. Nothing here deletes.
- **Bundle write guard** (`src/kernel/capability.ts`) — no agent edits a bundle
  file directly. Any Edit, Write or `apply_patch` aimed inside
  `.paqad/ledger/feature-evidence/` is blocked before the mode and scope checks, and the
  message names the verb that owns the file (read from the manifest `writer`), or says the
  file does not belong there when no verb writes it. The rule cannot be tuned. Framework
  scripts write through `fs`, so they never hit it. A shell write gets past the hook, so the
  `bundle-completeness` gate re-checks every file that carries the envelope header against its
  `content_hash` and fails a file changed outside its writer.
- **Session control** (`session-control.ts`) — the `_session/<sessionId>.json`
  active + paused-feature stack + lane store, folding today's `.open` +
  `.pending-lane` role at feature grain (set-active pauses the prior active; resume
  pops a paused feature; mark-done clears). `setActiveFeature` is the only writer that
  replaces `active`, and it always pushes the outgoing ref onto `paused[]`, so switching
  a session's change can never drop the one it was on — every caller that redirects a
  session goes through it for that reason. Every write stamps `written_by` (the writing
  verb or hook — `set-active`, `resume`, `reconcile`, `rename`, …) and the writer's
  `pid`, so a stale rewrite — the lost-update shape where one process reads
  the control while a change is active and writes its stale copy back after the change
  closed — is traceable to its source. Both fields are additive: a control written before
  them still reads.
- **Generic-slug back-fill** (`rename.ts`) — a feature opened by a bare
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
  and the stage-evidence `foldRowsWithKey` core. Each row is stamped by the
  envelope's `stampBundleRow`: the six-field header (`schema_version` 2, `doc_type`
  `paqad.stage-evidence`, `change` = the folder-name ULID from `featureChangeKey`,
  `session_id`, `recorded_at`, `content_hash`) and then the row's own fields. `ts` and the
  retired `conversation_ordinal` are no longer written; readers take the time through
  `rowRecordedAt`, so a bundle written before the one-packet change still folds. Session ledgers outside a
  bundle keep `ts`.

  `resolveFeatureRef` / `resumeFeatureByRef` are the readers behind
  `paqad-ai resume --feature <ref>`. A ref resolves against the **session control first**
  (active, then the paused stack, most-recently-paused first) and then against the
  **bundles recorded on disk** — each tier matched exactly on dir name, ULID
  or issue before either falls back to a slug substring, so a precise ref never loses to a
  loose match. The on-disk tier exists because the control is not the whole record:
  `markDone` drops a finished change from it, and a session-id rotation leaves a bundle in
  a control this session never reads, so a control-only lookup made recorded evidence
  unreachable through every supported command and left hand-editing
  `_session/<id>.json` as the only recovery. Resuming a bundle from the on-disk tier goes
  through `setActiveFeature`, so the change the session was on is paused rather than
  dropped. Resuming a **closed** change reopens it: `resumeFeatureByRef`
  appends an `open` row (append-only — the `close` row stays on disk) and flips
  `feature.json` status back to `active`, so the closed-bundle guard no longer releases it and the
  next stage row lands there. This is the one legitimate way to write into a closed
  bundle again. Neither reader mints.
- **Bundle enumeration** (`enumerate.ts`) — `listFeatureDirs` lists every feature dir
  under the evidence container. A leaf (paths + `readdir`, nothing else) so both
  `delivery.ts` — which re-exports it, keeping existing importers unchanged — and
  `adoption.ts` can use it without closing an import cycle.
- **Session-rotation adoption** (`adoption.ts`) — the carry-over that keeps
  ONE change in ONE bundle when the host session id rotates mid-change (an app relaunch,
  a resumed conversation, a rotated `SE_SESSION`). The active feature is tracked per
  session, so a rotated id read a fresh control, found nothing active, and minted a
  second `change-<ULID>` — orphaning the bundle the change was already recorded in.
  `reconcileSessionControl` repoints a session's control at the single **in-flight bundle
  on the current branch** (`listAdoptableFeatures`) when its own `active` names no
  evidence — either unset, or a dir that was never materialized
  (`isBundleMaterialized`). It is wired into `resolveActiveFeature` and `currentFeature`
  so the write and read paths agree, and into the SessionStart hook so a rotation is
  carried over before the agent records anything. A stale `active` pointer at a
  **currently-closed** bundle is released too: a closed bundle still has
  rows, so the materialized check alone handed a finished change back as active and the
  next stage/edit appended into it. `isBundleClosed` (the last lifecycle row is a
  `close`, so a reopened bundle reads live) tells the guard to treat such a pointer as no
  active change, release it, and fall through to adoption or the caller's mint. A dangling
  pointer at an unmaterialized dir is still left in place (REPOINT-ONLY), and the broad
  `listAdoptableFeatures`/`sessionClosedAnyFeature` "ever closed" filters are unchanged.

  **The branch is what makes it work** (decision `D-01KXY55ZM70Y3JNDM8E0XC7WSX`). "In
  flight" on its own means real stage rows and no `kind:'close'` row
  (`listInFlightFeatures`), and that set only grows: a change that was abandoned, and a
  change shipped without a passing verdict, never get a close row either. This repo held
  13, so an "exactly one in flight" rule could never fire and adoption was dead code. A
  session id rotates *within* a change and a change is built on one branch, so the branch
  identifies the rotated session's own work — deterministically, with no clock heuristic
  and no tunable window. `openFeatureChange` records `branch` on `feature.json` at open
  (a bundle written before the one-packet change stamped it on its `open` row, which is still read) so it is
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

  The close is the LAST thing the turn-end verification does. The evidence
  rows, receipt, AI-BOM, change metrics, decisions index and the completeness gate all
  work on the active change, so the verifier passes `deferClose` to the finalizer and
  calls `closeVerifiedChange` once they have run. A change the completeness gate fails
  is left open, like an incomplete one, so the next turn checks it again.

  That close row is also what stops a FINISHED change being re-opened as a phantom.
  `sessionClosedAnyFeature(projectRoot, sessionId)` is true when any bundle
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

Later phases wire the live recorder onto the feature ledger, plan/spec
compile, re-homed sub-ledgers, native git hooks, on-demand projections, and cutover
onto this base.

**HTML evidence report** — a human-readable projection of the bundle:

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
  comes from the rigid `review.json` like any other bundle file);
  `featureReportEnabled` reads
  the `feature_report` config flag; `resolveReportFeatureRef` resolves the active /
  most-recent / explicit-ref feature. Generation is wired into `runRepositoryVerification`
  (Claude / Codex / Gemini via the one backstop) and `delivery-link commit|merge` (advisory
  hosts via git hooks), and exposed as `paqad-ai feature report`. All best-effort: it never
  changes a verification verdict or a stage row. No code path opens the OS browser (the
  auto-open-on-completion behaviour, the manual `--open` opener, and their
  config knob).

### The HUD snapshot

`src/hud/` is the data layer of the paqad HUD, the Claude Code mod that keeps the change on
screen. It writes one file per session, `.paqad/session/hud/<session>.json` (schema
`paqad.hud/2`), built only from records paqad already keeps: the routed workflow and its saved
reason, this bundle's `feature.json`, folded stages, `experts.json`, `high-table.jsonl`, `clarification.json`,
`specification.json`, `evidence.jsonl` (with `GATE_STRENGTH_TIER`), `rules-loaded.json`,
`rule-run.jsonl`, `duplication.jsonl`, `delivery.json`, `cost.json`, the decision folders, the bundle manifest (with the shared
`buildBundleCompletenessConfig`) and the in-session receipt. A field whose source does not
exist yet (claims, the last rule stop, push/PR/CI, a cost no hook has written) is `null` or
empty, never guessed. The headline and the flags are decided in one place
(`computeHudHeadline`, `computeHudFlags`); any open flag turns a Safe to merge amber.

The `table` field (`src/hud/high-table-view.ts`) is the live High
Table: each seat with its state (`seated`, `writing`, `done`), its times, granted budget, findings,
the exact tokens from its own subagent transcript (or its self-reported estimate, marked as such),
its track record on the project's earlier changes, then the chief's seat, verdict and rulings, the
gaps, the questions asked and auto-answered, and which spec lines each role shaped. It is `null`
on the fast lane and when no table sat. A spec frozen by hand while the pipeline was on reads
`skipped: true` and raises a flag; a table whose work landed after the freeze reads
`met_after_freeze: true`, raises a flag and is credited with no spec line.

The `findings` field comes from the change's latest `rule-run.jsonl`
findings row and latest `duplication.jsonl` row: for each scan its status (`open`, `clean` or
`did not run`), counts, whether it blocks, whether it came from the cache, the kept findings and
the overflow. It is `null` when neither scan left a row. A scan with no row reads `did not run`,
never `clean`. An open finding raises a flag (`2 rule findings are open.`, `1 near-copy of
existing code is open.`), so the band shows findings only as a count in the flag pill.

- **Who writes it.** The verbs that move a change (`decision create|resolve`, `rules load`,
  `lane set`, `route set`, `stage`, `plan compile`, `spec pipeline experts …`,
  `spec freeze`, `review record`, `checks run`, `delivery-link`, `deliver`) through one
  commander post-action hook, and the hooks `agent-entry-prompt-gate`, `stage-writer`,
  `stage-marker-parse`, `verification-completion`, `stage-agent-completion` and
  `capability-gate completion` at their exit, after the decision is final
  (`runtime/hooks/lib/hud-snapshot.mjs`). `capability-gate pre-mutation` does not refresh:
  it runs before every edit and nothing it records reaches the snapshot yet.
- **Never changes a decision.** Every write is atomic (temp file, then rename) and
  best-effort; a failure is logged to `.paqad/logs/hook-failures.log`. Measured cost on the
  stage-writer hook: about 43 ms per run. Building the snapshot only reads the shared session
  cache: it uses the hook's session id when it has one and never rewrites the cache.
- **Stands down** in a project that was never onboarded and while paqad is disabled.
- **Read it** with `paqad-ai status --hud` (text) or `--hud --format json` (the object).

### The HUD band in Claude Code

The plugin draws the snapshot as a band above the prompt. The mod lives in
`runtime/claude-plugin/mod/` and is declared in `.claude-plugin/plugin.json`. It only shows and
answers: every check stays one of the plugin's hooks in `hooks.json`, so the mod being off,
blocked or broken changes no hook's decision. It reads only `.paqad/`, calls no model and no
network, and starts no process.

- **What the band shows.** A state word with its colour, the headline, a flag pill when flags
  are open, and two instruments (three when the High Table sits). *Stage* walks Intake, Planning, Spec, Build, Review, Checks,
  Docs and Deliver, with a live clock on the running stage. *Ship* walks Edit, Commit, Push, PR,
  CI and Merge, and Merge reads "stays yours" until a merge is recorded. A stage reads done only
  when the receipt would say done: an unbacked `checks` stage is marked, not done. A field with
  no record reads "not yet". The cost pill reads "not yet" until a hook writes the cost, then
  shows the tokens and a dated estimate, and opens the Cost tab when pressed.
- **The High Table instrument** (`runtime/claude-plugin/mod/table.ts`).
  On the graduated and full lanes, with the experts on, a third row sits between Stage and Ship:
  one dot per seat plus the chief, each state with its own glyph (seated, writing, done) so it
  reads without colour, and a live count in words while the table sits. Once the chief has ruled
  only the dots stay, plus a flag pill while the table has an open flag (a late seat, a
  disagreement still waiting on its decision). A skipped table says so. Pressing the label opens
  the High Table tab.
- **The live card.** While the table sits, a card is drawn over the change's first
  `paqad-ai spec pipeline experts` call in the chat and redrawn in place as seats move: each
  seat's state and time, tokens and findings, then the chief's ruling in counts.
- **The paqad pane.** One pane with five tabs, opened by the High Table label or the cost pill
  (`runtime/claude-plugin/mod/pane.ts`, the tab lines in `tabs.ts`).
  *High Table* shows the round table with the chief in the centre (a picture on Desktop, text in
  the terminal), a button per seat with its detail and track record on earlier changes, the
  chief's rulings (accepted, declined, renamed, disagreements and those settled before) and
  which spec lines each role shaped. *Cost* shows the change cost described below. *Trust* shows
  the verdict, a ring of the required gates only (a not-required gate is listed but never
  counted), every gate grouped by strength (deterministic, judged by a model, strength not
  recorded) with its verdict in words, each claim with its proving test, and the open flags.
  *Ships* shows the change's own commits against the commits riding along from other tickets
  (amber), or, when the only earlier commits carry no ticket, plainly as "untagged, made before
  this change started", then the push, the PR, CI (a partial "3 of 7 done", and "unknown, never recorded" when no CI was
  saved, never a green default), the merge and how to roll it back; every value comes from the
  bundle's `delivery.json`. *Record* shows the plan, the decisions waiting and resolved, the rules
  and whether the receipt is written. An empty tab names its state: "No gates judged yet.",
  "Nothing pushed yet.", "No plan recorded yet.". Below 80 columns the tab labels shorten.
  The pane picks its tab on its own only until the person picks one: a delivery in progress
  (the delivery stage running, or CI pending) opens Ships, a landed verdict opens Trust, a
  sitting High Table opens High Table, otherwise Cost. Once a tab is picked it stays for the
  session. A failing or pending CI is never drawn as done on the band's Ship row.
- **The receipt card and the seal** (`runtime/claude-plugin/mod/receipt.ts`). `/paqad receipt`
  is drawn as a card in the command's output row: a seal line with the verdict in words and its
  colour ("Not sealed" before a verdict lands), then the receipt itself. When a new verdict lands
  the HUD shows one toast naming it, once per verdict however often the snapshot is rebuilt; a
  verdict already there when the session starts is not toasted again. The seal is drawn still,
  with no motion, so there is nothing to turn off for reduced motion.
- **Evidence above a decision question** (`runtime/claude-plugin/mod/ask-evidence.ts`). When the
  agent asks a waiting `fix.proof_method`, `spec.expert_conflict`, `delivery.open_pr` or
  `intake.requirement` decision through AskUserQuestion (matched on the question text or the
  decision id), the mod reads that packet from `.paqad/decisions/pending/<id>.json` and draws
  each option's evidence above the engine's own card, one row per item (file, callers, rule,
  findings). Claude Code allows 12 rows around the dialog in the terminal and 48 elsewhere, so a
  longer list shows as many rows as fit and a last "+N more" row. A missing or unreadable
  packet, or one with no evidence, draws nothing and the question is answered as usual. paqad's
  own rule-stop questions (headers "Rule stop" and "Reason") are left alone.
- **The nine states** (`BAND_STATES`, first match wins): Needs you (a decision is waiting),
  Stopped (a rule stopped an edit), Paused, Ready or Working when no change is in progress,
  Branch warning, Working (a stage runs), then the verdict: Safe to merge, Needs your attention
  or Inconclusive. Any open flag turns a good or neutral state amber. The words always say what
  the colour says.
- **When it refreshes.** On session start, prompt submit, a finished edit, an Agent call or a
  Bash call that runs `paqad-ai`, once more shortly after a turn ends, and on a short tick
  while a stage agent runs.
- **`/paqad` commands.** `/paqad` (overview), `/paqad status`, `/paqad decisions`,
  `/paqad rules` (rules loaded plus open rule findings and near-copies), `/paqad receipt` (the
  session's `<session>.receipt.md`), `/paqad cost` (the same text as the Cost tab) and
  `/paqad trust`, `/paqad ships` and `/paqad record` (the same lines as those tabs). Each answer comes from files already on
  disk, so it costs no model turn.
- **The `hud_view` setting.** The paqad config key `hud_view` (env `PAQAD_HUD_VIEW`, on by
  default) turns the band off. The mod reads it the same way it reads `paqad_enable`: the env
  variable first, then `.paqad/.config`, then `.paqad/configs/.config.*` with the last file name
  winning. Off, the mod draws no band, reads nothing and registers no `/paqad` command. The
  plugin declares no `userConfig`, because Claude Code lists every declared option with no saved
  value as "not yet set" when the plugin is installed, even one with a default.
- **The `hud_chime` setting.** The config key `hud_chime` (env `PAQAD_HUD_CHIME`, off by default)
  makes the mod play one short chime when a verdict lands, once per verdict. It resolves like
  `hud_view`, lives in the team app config, and is a chime only: the mod never speaks.
- **Chips, spinner, lane and heartbeat.** paqad's own `paqad-ai` Bash rows read as chips with
  their state in words, the spinner names the running stage, the footer names the lane, and a
  fresh `.paqad/session/hud/<session>.live` heartbeat lets the prompt gate ask the agent to skip
  the per-stage narration lines the HUD already shows (the Claude Code technical page has the
  detail).
- **Stand-downs.** The mod also stands down when the project was never onboarded, when the
  session runs in the cloud (`CLAUDE_CODE_REMOTE=true`), when paqad is off for the project
  (resolved the same way the hooks resolve it), and on Claude Code older than 2.1.301. While it
  stands down it draws no band and reads nothing. In a project never onboarded, `/paqad` alone
  stays, so `/paqad status` can say paqad is not active here.

### The cost of a change

paqad counts what a change cost and writes it to the bundle as `cost.json`. Nothing here calls a
model or the network: the tokens come from the host's own transcripts and the money from a price
table that ships with paqad.

- **Where the tokens come from.** The main session's transcript (its path comes on every hook
  payload) and each paqad subagent's own transcript (the SubagentStop payload names it). Each
  message is counted once, by its message id, even when the host writes it over several lines or
  copies it into two transcripts.
- **Which tokens count.** Only those inside the change's window: from its first `open` row in
  `stage-evidence.jsonl` to its seal (the receipt's verified time, else the close row, else now).
- **Who spent what.** A stage agent is charged to its stage. A High Table seat is charged to its
  role (the chief to the chief) and, since the table sits while the spec is written, to the
  specification stage. Everything else is charged to the stage whose recorded start and end hold
  the message's time, else to "between stages". A seat with no transcript of its own shows its
  self-reported estimate, marked as such and kept out of the total.
- **Money.** Tokens times the published API price, from the dated table in `src/cost/prices.ts`
  (copied from platform.claude.com on 2026-10-19). Money is always shown with the word estimate
  and the price date. On a Pro or Max plan it is what the same tokens would cost on the API. A
  model the table does not list adds its tokens and no money, and is named.
- **Not counted.** The fast mode premium, the 1.1 times multiplier for US-only inference, batch
  discounts, tool fees charged on their own, subagents that are not paqad agents, and anything
  outside the window. The record lists these itself.
- **When it is written.** At the end of the Stop hook (`verification-completion`) and the
  SubagentStop hook (`stage-agent-completion`), after each hook's decision is final
  (`runtime/hooks/lib/cost-refresh.mjs`). It is record-only: a failure is logged to
  `.paqad/logs/hooks.log` and the hook's exit code and output stay the same. A host that names no
  transcript gets no file, so the HUD keeps "not yet" instead of a cost of zero.
- **Kept cheap.** A per-session cache, `.paqad/session/hud/<session>.cost-cache.json`, keeps how
  far each transcript was read and the usage of each message kept. Each run reads only the bytes
  added since. A transcript that shrank, or an earlier window, is read again from the start, so
  the cache never disagrees with a full read.
- **Details that keep it right (`src/cost/`).** The cache's read-merge-write runs under a
  cross-process lock, because the High Table's seats end together and their parallel SubagentStop
  hooks would otherwise drop each other's transcript paths; when the lock cannot be taken within
  5 seconds the update is skipped and logged, and the next hook records the path again. Subagent
  transcripts are read before the main one, so a message the host also copied into the main
  transcript keeps its stage or seat. A message with no readable time cannot be placed in a window
  and is not kept, and a transcript that has gone missing keeps what was already read. A message's
  repeated lines can disagree (an early line can carry a smaller running output count), so the
  largest figure per field wins. The reader streams fixed-size chunks and carries an unfinished
  line over as bytes, so a multi-byte character split across chunks still decodes, and a last line
  with no newline is counted only once it parses, since the host may still be writing it. Model ids
  are normalised before the price lookup (provider prefix, bracket, version, date and `-latest`
  suffixes removed), a cache write the host did not split by lifetime is priced as a 5 minute
  write, and sums are rounded to a hundredth of a cent so a stored total does not drift.
- **Where it shows.** The snapshot's `cost` field reads `cost.json` only, and
  `paqad-ai status --hud` prints it (the JSON form carries the same object). In Claude Code the
  band's cost pill shows the tokens and a dated estimate; pressing it opens the paqad pane on its
  Cost tab, which shows the total, the split by stage, by expert and the chief, the basis in plain
  words and what is not counted. `/paqad cost` prints the same text.

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file in `src/feature-evidence/`.

**Import cycles.** `adoption.ts`, `enumerate.ts` and `delivery.ts` stay leaves on purpose.
`adoption.ts` reads the `branch` field of `delivery.json` itself instead of calling
`readFeatureDelivery`, and `recordCommitForBranch` takes the active feature as an argument, because
adoption to delivery to stage-ledger to adoption would be a cycle. `receipt.ts` imports from the
leaf `envelope.js`, not `project.js`, for the same reason. `index.ts` does not star-export
`enumerate.js`, because `delivery.js` re-exports its one symbol and `export *` would then see the
same binding twice.

**`artifacts.ts`.** The plan's `reuse` field is typed optional only so a malformed template reaches
the validator and gets its message. The computed provenance is applied to a copy, never the
caller's template. `spec.md` is written before `specification.json`, so a spec record on disk
always has its signed source beside it. The create-vs-reuse pause is armed after the plan is
written, so an arming failure never loses the plan. A review template may still carry a `title`
from an older template; it is accepted and not stored.

**`bundle-integrity.ts`.** `classifyBundlePath` normalises the path again even though callers
already do, because a stray `./` or a backslash must never read as "not in a bundle". It does not
accept an in-flight `.tmp` file as an artifact, since that would let `--artifact <bundle>/notes.tmp`
pass and stay invisible to stray detection; `strayBundleFiles` does tolerate temp files, since
they exist for an instant during a write. Whether a bundle predates the envelope is judged from
the first stage row and the spec source, never `feature.json`, which `updateFeatureRecord`
rewrites. Screenshot slugs are Windows-safe (no `:`). Nothing here deletes a file.

**`bundle-ledgers.ts`.** The RAG ordinal uses a doc type whose session-ledger folder is exactly
the session's `_chat` folder, so the background worker, the TS recorder and the prompt seam share
one allocator. A rule-run cache hit that would repeat the last row is not appended, so the bundle
does not grow on every edit. The RAG mirror never throws, so recording cannot break the prompt.

**`decisions-index.ts`.** A resolved packet is linked to a change when it names the change in its
`change` field; or names no change but carries the change's ULID in its context (the tokens
automated pauses embed); or names neither and was resolved while the change was open (from
`feature.json` `recorded_at` until done), which covers packets written before the `change` field
existed. A packet naming another change is never linked. An unchanged index is not rewritten.

**`delivery.ts`.** Commits are read with a NUL field separator so any subject round-trips. A
`post-commit` fires after the bundle is closed, so the newest matching bundle that is not yet done
wins over a finished one. "Newest" is ordered by the trailing ULID, never the full folder name,
whose slug would dominate.

**`envelope.ts`.** Front-matter values are written as JSON scalars, which are also valid YAML, so
reading them back needs no YAML dependency. The body after the front matter is returned byte for
byte, because for `spec.md` it is the signed source. `<` is escaped in the report header tag so
no value can close the tag early.

**`export.ts`.** Retention orders bundles by ULID and never removes a change that is active or
paused in any session; such a change also does not use up the keep count.

**`feature-record.ts`.** The lane only ever rises, and `updateFeatureRecord` is the one write path
for it, so no caller can relabel a large build as fast. When the seed was missed, a minimal record
is rebuilt with a placeholder adapter rather than inventing the session that opened it.
`updated_at` moves only when the identity changed, so a per-stage patch never churns the file.

**`git-hooks.ts`.** Git's own `post-commit` and `post-merge` are the one signal every host shares,
and `--no-verify` does not skip them. The installer appends after an existing hook and never
replaces it. A hooks folder git tracks (husky's `.husky/`, a committed `.githooks/`) is never
written, since that would make a diff and husky drops appended blocks; the line is printed
instead. Containment is checked on a folder boundary so `.githooks` is not read as inside `.git`.
The tracked check uses a repo-relative, forward-slash pathspec, because an absolute one read empty
on Linux CI. The hook block uses forward slashes since it runs under `sh`, also on Windows, and
falls back to `node <paqad>/dist/cli/index.js` because the plugin puts `paqad-ai` on PATH only
inside a Claude Code session. Every line ends in `|| true`, so git is never blocked. The block
starts with the marker line `# paqad-ai delivery-link`. Older versions wrote that same marker with a
ticket reference in parentheses after it, and those blocks are still in users' hooks, so the
installer looks for the marker text anywhere in the hook rather than as a whole line; an old block
is found and no second one is added.

**`mint.ts` and `paths.ts`.** The ticket ref is removed from the title before slugging so the
folder name does not repeat it. A bare number is removed only as `#<n>` or when it leads the title,
so "Show 45 rows" keeps its number. A GitHub `#<n>` becomes `<n>` so the name stays parseable, and a
leading numeric slug segment is read as a GitHub issue. Paths use `pathe` so the folder name, a
stable key, is the same on every platform. A plan with no `reuse` omits the key rather than
writing `undefined`, which would hash differently.

**`manifest.ts`.** `checks.json`, `visual-evidence.json` and `rules-loaded.json` are `optional`
and not flag-gated: the completeness gate cannot tell whether a change mapped any checks or was a
frontend change, so requiring them would fail changes falsely, and there is no flag to be off.
Each has its own gate that does the real enforcement. `tech-debt.json`, `rule-overrides.jsonl`
and `fix-proof.json` are `optional` for the same reason: most changes record no debt, no override
and no fix proof. The fix-proof gate is the one that asks for proof on a fix.

**`report.ts` and `report-writer.ts`.** A feature receipt is chained to the feature's own earlier
receipt, so its `prev_receipt_hash` is legitimately non-zero; it is checked with
`verifyFeatureReceiptSelf` because `verifyReceiptChain` assumes a chain from zero and would read it
as broken. Rows are de-duplicated by `content_hash`. A plan's `then` text can arrive cut short, so
it is rendered as found. Screenshots are linked by relative path so the page works from
`file://`. The report flag is not gated on enterprise. `writeFeatureReport` throws so tests can see
failures; every caller wraps it.

**`reuse.ts`.** `CREATE_KEYWORDS` pairs a create verb with a construct noun, so "add a test" does
not demand a new-construct entry. A shape error stops the checks, so index errors do not bury it.
The nearest-symbol threshold grows with the name's length, and no suggestion is better than an
unrelated one. A framework claim's version is passed to the index so a monorepo with two versions
answers for the one the plan named.

**`session-control.ts`.** A missing or corrupt control reads as a fresh one, so a crash mid-write
cannot wedge a session. Resuming a feature the control does not know returns null rather than
minting one.

**`stage-ledger.ts`.** `agent` is required by the schema and defaulted at the one append path.
When two or more bundles are already in flight on the branch, the mint path refuses instead of
forking a third under stage isolation. A bundle file is checked with one read and a catch, never
stat then read, to avoid the race CodeQL flags. The recorded lane fails safe to `full`.
`currentFeature` reconciles on the read path too, so the finalizer never writes its backstop into
a fresh bundle after a session-id rotation.

### The stage-evidence ledger (`src/stage-evidence/`)

The stage rows a bundle holds are written by `src/stage-evidence/`. The reasons below are not
obvious from its code, grouped by file.

- **`agent-identity.ts`.** The host names the agent: a Claude subagent's hook payload carries
  `agent_type` (the agent's name) and `agent_id` (an opaque per-dispatch id); the main thread
  carries neither. `agent_type` is preferred because it is stable; `agent_id` is the fallback, since
  stamping `orchestrator` on a row a subagent wrote would be worse than an opaque id. The completion
  backstop passes its own name as the adapter, so it never replaces the host on `feature.json`.
  Only the six `paqad-<stage>` names count as stage agents; a High Table seat does not.
- **`artifact-path.ts`.** `path.join('/repo', '/tmp/x')` ignores an absolute second argument, so an
  out-of-tree path used to become a missing in-repo path, hashed as absent, while the CLI printed
  `recorded:true`. The validator runs once at each caller boundary (the CLI flag and the chat
  marker): an in-tree path, absolute or relative, becomes project-relative; an out-of-tree path is
  rejected. It judges location only, never existence, so a missing in-tree file is still recorded
  as `:absent`. The path is compared with both forms of the root (its realpath and its lexical
  form), because `realpath` falls back to the lexical path for a file that does not exist yet
  under a symlinked root such as macOS `/tmp`.
- **`bundle-artifact.ts`.** `planning`, `specification` and `review` own a rigid, script-written
  bundle file (`plan.json`, `specification.json`, `review.json`), and nothing else is their
  artifact; a hand-written plan file never clears the gate. A non-rigid stage may not prove itself
  with a file inside a bundle dir either, and never with anything under `screenshots/`. With no
  active feature, a rigid stage has nowhere to write, so every path is rejected.
- **`completion-deferred.ts`.** Desktop and VS Code run subagents in the background, so the
  orchestrator's turn can end while a stage agent still works. When a `paqad-` agent is among the
  Stop payload's `background_tasks`, the Stop seam records one `completion-deferred` row and
  computes no verdict and runs no rule scripts. When no entry names an agent type at all (an older
  payload shape) and the session's bundle has a started but unended stage, it defers too. An
  empty or missing list behaves as before.
- **`effective-lane.ts`.** The pre-mutation gate and the live writer derive the lane from this one
  leaf, so they agree; it is a leaf because capability to narration to live-writer back to
  capability would be a cycle. A `sensitivity: high` module floors the lane to `full`, and a null
  lane fails safe to `full`.
- **`finalize.ts`.** It runs from the verification backstop after the enabled check and before the
  enterprise block, imports no enterprise code, and never changes the verdict when it fails. With
  no open record and a real code diff it writes one inferred-git backstop record, honestly
  `incomplete`. That backstop is skipped when this session already closed a change, because the
  working-tree delta is the whole branch and would otherwise mint a bundle for finished work on
  every later turn. Each Stop re-verifies; a passing change is closed so the next edit opens a
  fresh change, and an incomplete one stays open for the redo loop. Still-open live-mark stages are
  ended at the completion clock, and a missing `development` row is backfilled from the delta,
  because the live writer defers until the pre-code stages exist.
- **`fold.ts`.** An end with no start is inconclusive (the inferred-git backstop's end-only
  `development` row is exempt). A thinking stage whose end carries no digest is inconclusive. A
  stage whose end predates its own start is reported as an ordering violation against itself,
  because the pair loop only compares two different stages. `review` takes part in no ordering
  pair. A missing or empty `plan.json` or `specification.json` drops a complete verdict to
  `incomplete`; presence is passed in so the fold stays free of the filesystem.
- **`live-writer.ts`.** Only file-mutating stages are inferred from edits; `planning` and `review`
  arrive through markers, since inferring them from an edit would be a false mark. Tests map to
  `checks` before `development`, and `docs/instructions/**` maps to `specification`. No stage is
  recorded until the lane's pre-code stages have started, using the same helper as the gate.
  Without a host session id the row is left unstamped rather than guessed. An out-of-order edit is
  left for the completion gate. Before a marked stage opens, every other open stage is closed,
  because `review` sits below `checks` and `documentation_sync` in the order and an index-based
  close would miss them. The writer never throws.
- **`marker-parse.ts`.** Only assistant text is read (Claude nests it under `message`, a Codex
  rollout under `payload`), so a quoted marker in a tool result is not taken as one the agent
  emitted; the narration audit reuses the same extractor. Markers are never recorded on a route
  proven not to be feature development, and never after this session closed a change, since the
  whole transcript is re-read every turn. An out-of-tree or non-rigid artifact is dropped, so the
  boundary still records but honestly inconclusive. The drop keys on `accepted`, not `rigid`, so
  the chat path and the CLI agree.
- **`mode.ts`.** `strict` is the default. The team value is a floor; the local `.config` and
  `PAQAD_STAGES_MODE` may only raise strictness, so only a team commit can lower it.
- **`narration-audit.ts`.** Hook `{systemMessage}` output is not rendered on Desktop, so only the
  agent's visible `▸ paqad` lines count. Only agent-authored stages can be unnarrated; inferred and
  null provenance are not. The finding is advisory and fails open on an unreadable transcript.
- **`narration.ts`.** The entry line is a read-only predicate that reuses the writer's own entry
  decision, so the two cannot drift. Only a stage's start is spoken; the receipt carries the ends.
- **`pending-lane.ts`.** The prompt seam stashes the lane before any change exists; the next open
  stamps it. The stash is cleared when the route is corrected away from feature development.
- **`recorder.ts`.** Unlike the RAG recorder, a validation failure throws, because these are
  explicit agent calls. A start is never rejected for being out of order, since that made the
  pre-code stages unrecordable; ordering is judged at fold time. The artifact digest is null when
  no named file has real, non-empty bytes, and missing or empty files still add `:absent` or
  `:empty` to a mixed digest. Each file is read once with a catch, never stat then read. The adapter
  and lane go to `feature.json`, never onto the row.
- **`schema.ts`.** The schema lives in `src/`, never under `.paqad/`, so the model cannot weaken it.
  `agent` is required because the one write path always supplies it; reads never run the
  validator, so older rows stay readable. The version-1 shape is kept so an old row validates. The
  `spec-step` `step` is not an enum because the feature-development path never imports the spec
  pipeline.
- **`scope.ts`.** Scope is an exclude list (docs, `.paqad/`, host-agent config dirs), never an
  allowlist of source dirs, because an onboarded project can be any stack. `.github/` stays in
  scope since it holds CI code. `.ai/` (JetBrains MCP config) is excluded because paqad never
  writes it but a stray edit there failed read-only turns. An unknown path is in scope.
- **`stages.ts`.** The order comes from `STAGE_ORDER` in the feature-development policy. The fast
  lane needs only `planning` before code; every other lane, and an unknown one, needs `planning`
  and `specification`. This one helper serves both the gate and the writer. `review` is
  completion-anchored: an honest review of the finished diff lands after `checks` and
  `documentation_sync` in time, so it is exempt from ordering but never from being present.
- **`verify.ts`.** The redo cap counts only failed verifies since the last stage mutation, so new
  work resets it, while repeated Stops with no new work still reach `blocked`.

### The HUD, stage agents and the plugin build (`src/hud/`, `src/stage-isolation/`, `src/plugin/`)

- **`hud/cost-view.ts`.** The snapshot's cost reads `cost.json` only and never a transcript, so a
  refresh from a verb stays cheap and can never disagree with what the hooks recorded.
- **`hud/files.ts` and `hud/snapshot.ts`.** The HUD is a view, so `writeHudSnapshotSafe` never
  throws: a failure is logged to `.paqad/logs/hook-failures.log` and `.paqad/logs/hooks.log`, and
  when even the log write fails the caller still gets its answer, so a read-only tree never turns
  into a throw. The latest row per gate wins, so a gate re-run later supersedes its first verdict,
  and a drift row from the reconciler is not read as a rule scan. A stage whose recorded start and
  end look implausible reads as marked, never done, the same as the receipt. The track record
  reads only the newest few bundles so a refresh stays cheap, and a failed read counts as no
  history.
- **`hud/high-table-view.ts`.** A run recorded before the High Table ledger existed has no rows;
  its note counts as landed when tokens or findings are on record. A synthesis on record means the
  chief ruled, whatever rows exist. A fast-lane freeze never had a table to skip, so it shows none.
- **`hud/receipt-file.ts`.** The Stop hook computes the full receipt but prints little of it, so
  the backstop writes it to the session's HUD files for the HUD and `/paqad receipt`. A turn that
  was not checked (a skip verdict, or no gates and no decided kind, which would otherwise derive
  to Safe to merge) writes nothing, so the last real verdict stays on screen.
- **`hud/refresh.ts`.** A verb path refreshes when it equals a listed path or starts with one
  followed by a space, so `spec pipeline experts` covers its subcommands.
- **`stage-isolation/agent-writer.ts`.** Stage agents are written only at user scope
  (`~/.claude/agents`, `~/.codex/agents`), never into a project, which is why this does not use the
  project-scoped `BaseAdapter.generateAgents()` (a test asserts agents are never written into a
  project). The writer is synchronous so the synchronous `bootstrapFramework` can call it; the
  templates use no custom Handlebars helpers. The plugin build renders its Claude agents through the
  same function, so there is one template path.
- **`stage-isolation/stage-agents.ts`.** Agent names are hyphenated (`paqad-<stage>`) so the
  `^paqad-` SubagentStop matcher fires only for paqad agents, while the body records under the
  underscored ledger stage name. `ticket_intake` and `delivery` get no agent: intake is orchestrator
  routing and delivery is the human-gated PR step. Only the six stage agents map to a stage, so a
  High Table seat or any other `paqad-` name never adds a `stage-agent` row.
  `isSubagentCapableAdapter` reads the writer's host roster so the completeness gate and the
  installer cannot disagree; Gemini and the advisory IDEs have no subagent dispatch.
- **`stage-isolation/subagent-completion.ts`.** It never blocks, since SubagentStop blocking is
  undocumented on Claude, and never throws. Without host usage it estimates about 4 characters per
  token and marks the row inexact. Both `cache_read_input_tokens` (Claude) and
  `cached_input_tokens` (Codex) are read as the cached slice. The optional `paqad:` plugin
  namespace is stripped first, so plugin and npm agents derive the same stage.
- **`stage-isolation/isolation-summary.ts`.** Older bundles kept the same facts in
  `context-efficiency.jsonl`, which nothing writes any more but is still read. Both sources are
  added together, because a change upgraded part-way has its early agents in the old file and its
  later ones as rows, and each agent was recorded by exactly one writer. With no stage agent on
  record the receipt prints no `context:` line rather than a zero.
- **`plugin/manifest-build.ts`.** The build script (importing from dist) and a golden test
  (importing from src) call the same pure builders, so there is no second renderer. Claude Code's
  plugin schema wants `agents` as a list of `.md` paths, not a directory, and rejects
  `displayName`. The mod is named beside `hooks`, so the hook entries are byte-identical with or
  without it.

### The change verbs (`src/cli/commands/`)

The CLI verbs that move a change are thin callers over the code above. The reasons below are not
obvious from their code, grouped by file.

- **`stage.ts`.** The verb resolves from the installed package on every project, unlike a
  project-local script, which is why the gate's remediation names it. It resolves the same session
  the live writer and the gate key on, so a manual mark clears the block in the session that hit
  it, and it stamps where the session id came from, since the shared cache file may name another
  live session. `--artifact` is normalized and checked against the rigid bundle file before any row
  is written. A dispatched stage agent has no hook payload, so it names itself with `--agent` or
  `PAQAD_STAGE_AGENT`. Only an unknown stage fails. The printed confirmation leaves out the session
  id, because echoing environment-derived data is flagged as clear-text logging; `resume` does the
  same.
- **`plan.ts`, `review.ts`, `spec.ts`.** The model fills a template and the script writes the rigid
  record, so the model never owns the stored bytes; the filled template is deleted after success so
  it is never a second source of truth. A reuse-gate failure prints its own lines, since each names
  the field to fix, and an evidence-armed or readiness pause is named plainly because it blocks the
  next edit. `spec freeze` runs the spec review itself, so its "no critical spec-review defects"
  promise holds and no separate report is written. A spec outside the project root, or inside a
  bundle dir, is rejected, and the frozen record stores a project-relative posix path. The spec
  source is deleted only once the frozen record is in a bundle; a standalone freeze with no active
  change persists nothing, so deleting there would lose the only copy. The fast lane never runs
  the spec pipeline, and an unresolved lane counts as full.
- **`lane.ts`.** The classifier picks a lane before it has read the ticket, so this verb lets the
  person or agent record the real lane; the write goes through the same ratchet, so it only ever
  raises it.
- **`route.ts`.** Correcting a route replaces the mislabelled entry instead of pausing it, and
  resumes a paused entry of the target workflow. It refuses to leave feature development once this
  session edited source files this turn (judged by its own rows, never the shared git tree). With no
  session id given, the check is skipped and the audit row says why, because a wrong label you
  cannot correct is worse than a logged correction. A stashed lane is cleared when the new route is
  not feature development.
- **`decision.ts`.** It wraps the existing packet engine so packets are created through the
  installed package on every project (the old script path only existed in the paqad repo).
- **`delivery-link.ts`.** Every subcommand exits 0 so git is never held up. When a branch has a
  bundle but the active pointer is gone, the reason the link missed is stamped on that bundle's
  `delivery.json`, since hook stdout is discarded. The report is regenerated here because git hooks
  fire on every host, including the advisory ones.
- **`delivery.ts`.** Pushing and opening a PR is outward-facing, so the `delivery.open_pr` pause is
  mandatory; a pending packet keeps it paused, and a minting failure still pauses rather than
  pushing unasked.
- **`discovery.ts`.** A write needs the run's owner stamp to be this session, failing closed, so
  the `--run` escape hatch cannot write into another session's run. A stage end takes only its one
  canonical artifact, and `completed` is refused until the stage evidence verifies.
- **`checks.ts`.** The acceptance-criteria map is written beside the report on a best-effort basis:
  a map that cannot be built is a warning, never a failed run.
- **`spec-pipeline.ts`.** Every verb writes through the run store; the brief and the merge are
  rebuilt in memory from what is stored, and only the brief's hash is kept. The experts verbs
  refuse when the experts flag is off. Questions the ledger can answer are removed before the
  batch is stored. High Table rows are written after the verb's own record, so a failed row is
  reported on stderr and never changes the result.

## Source Footprint

- `src/feature-evidence`
- `src/hud`
- `src/cost`
- `src/tech-debt`
- `src/core/text/marker-block.ts`
- `src/cli/commands/debt.ts`
- `src/fix-protocol/fix-prove.ts`, `src/fix-protocol/fix-proof-record.ts`, `src/fix-protocol/fix-change.ts`, `src/cli/commands/fix.ts`
- `src/rule-scripts/override.ts`

## Features

- [Tech debt (paqad-ai debt)](../features/tech-debt/business.md)
- [Fix proof (paqad-ai fix prove)](../features/fix-proof/business.md)
- [Rule stop and Allow once (paqad-ai rules override)](../features/rule-override/business.md)

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
- `tests/unit/stage-evidence/notification-displacement.test.ts` — the background-notification
  displacement path end to end: a completed change closed, then the turn a background
  notification produces, asserting no bundle is minted, no row lands in the finished
  bundle, no failing verdict is reached, the change stays resumable, and the first-change
  and other-session paths still open exactly as before.
- `tests/unit/feature-evidence/index.test.ts` — barrel surface.
- `tests/unit/feature-evidence/report.test.ts` — the pure HTML renderer (self-containment,
  verdict, honesty tags, receipt integrity, graceful empty states, determinism).
- `tests/unit/feature-evidence/report-writer.test.ts` — bundle → report.html writer, flags,
  review rendering from `review.json`, and ref resolution.
- `tests/unit/feature-evidence/bundle-file-set.integration.test.ts` — the full bundle file set
  per lane. Its timeout is raised because each case drives a full change plus verification and
  Windows CI is slow.
- `tests/unit/feature-evidence/bundle-integrity.test.ts` — bundle-path classification and
  stray detection (the rigid-only invariant).
