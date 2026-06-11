# paqad-ai

## 1.13.1

### Patch Changes

- [#136](https://github.com/Eliyce/paqad-ai/pull/136) [`6c53e5a`](https://github.com/Eliyce/paqad-ai/commit/6c53e5aa937336ec0221c81391f2761b2896b6e6) Thanks [@HLasani](https://github.com/HLasani)! - Full Windows support. Fixed every Windows-only failure tracked in [#43](https://github.com/Eliyce/paqad-ai/issues/43)-[#53](https://github.com/Eliyce/paqad-ai/issues/53) plus the follow-ups it surfaced: path outputs are now forward-slash everywhere (RAG file discovery, evidence retrieval, planning doc targets, pentest reports and retests, rule scripts, delivery policy, module-map snapshots, pack manifests), custom workflow execution artifacts no longer use characters that are illegal in Windows filenames, and onboarding re-runs stay byte-identical on Windows. The windows-latest leg now runs as a full CI gate.

## 1.13.0

### Minor Changes

- [#133](https://github.com/Eliyce/paqad-ai/pull/133) [`51e5904`](https://github.com/Eliyce/paqad-ai/commit/51e5904f38b854c51dbc5e92150ff4b947f0810e) Thanks [@HLasani](https://github.com/HLasani)! - Provider-agnostic delivery workflow ([#42](https://github.com/Eliyce/paqad-ai/issues/42)). The `ticket_intake` → `delivery`
  loop is now configured by a standalone `delivery-policy.yaml` — a workflow-policy
  peer of `feature-development.yaml` (same location, schema validation, and
  `merge_mode: append` precedence) — on by default with every section
  `maintained: auto | manual`.
  - **Two provider-neutral contracts**: `TicketProvider` (Jira adapter) and
    `HostProvider` (GitHub adapter), resolved from config + the MCP `kind`
    discriminator. Linear / GitLab / Bitbucket are additive adapters.
  - **Conventions are detected from git history** and silently fill the `auto`
    sections during `create documentation`, with an end-of-docs summary and one
    combined "connect GitHub + Jira" nudge. Detection persists to
    `.paqad/delivery-detection.json`; the commented policy file is never rewritten.
  - **CI-wait gate** (`wait_for_green` / `warn_only` / `off`) with timeout and
    `on_red` handling, plus **graceful degradation** when a provider is not
    connected (git-only steps still run; provider-bound steps are skipped and
    re-nudged — never a hard stop).
  - New **Delivery Workflow** dashboard section showing configured/active state and
    the GitHub/Jira connection.

  The old `conventions:` block in the project profile is replaced by
  `delivery-policy.yaml`.

## 1.12.0

### Minor Changes

- [#131](https://github.com/Eliyce/paqad-ai/pull/131) [`2cdfbcf`](https://github.com/Eliyce/paqad-ai/commit/2cdfbcf0c0c3557fc7fea08a358ae16057befaf6) Thanks [@HLasani](https://github.com/HLasani)! - Add the unified evidence ledger and a signed, gradeable per-change provenance receipt (issue [#118](https://github.com/Eliyce/paqad-ai/issues/118)).

  Every verification gate (and quality-ratchet measure) now fans into one append-only ledger at `.paqad/ledger/evidence.jsonl`, and the merge-time backstop projects a per-change receipt from it: an in-toto Statement (v1) with a SLSA-VSA-modelled predicate, wrapped in a DSSE envelope and tamper-evident hash-chained locally (`.paqad/ledger/receipt.dsse.json` + `receipts.jsonl`), plus a CycloneDX-adjacent AI-BOM view (`.paqad/ledger/ai-bom.json`). The anti-"provenance-theater" rule is enforced end to end: every row is graded by evidence strength — deterministic (Tier A) vs LLM-judged (Tier B) vs blocked/inconclusive (Tier C) — so a computed pass is never pooled with a model's say-so. Ledger/receipt failures never block verification.

## 1.11.1

### Patch Changes

- [#129](https://github.com/Eliyce/paqad-ai/pull/129) [`9046543`](https://github.com/Eliyce/paqad-ai/commit/904654309a963f1bad712d89d2e51ae2bafc4100) Thanks [@HLasani](https://github.com/HLasani)! - Fix `onboard` crashing with `EEXIST: file already exists, symlink` when a previous run left a dangling framework symlink (e.g. the npx cache directory it pointed at was garbage-collected). `ensureFrameworkSymlink` now detects the link with `lstat` instead of `existsSync` so dangling symlinks are cleaned up and replaced idempotently.

## 1.11.0

### Minor Changes

- [#127](https://github.com/Eliyce/paqad-ai/pull/127) [`30ba1c5`](https://github.com/Eliyce/paqad-ai/commit/30ba1c5f7e14b42323acddea7d2b7056885c23e2) Thanks [@HLasani](https://github.com/HLasani)! - Make the verification gates bind ([#117](https://github.com/Eliyce/paqad-ai/issues/117)). The existing gate runner now fires
  automatically from a completion hook and a git/CI backstop via a new exported
  `runRepositoryVerification` API, against repository reality, with the judgment
  inputs computed instead of stubbed:
  - C-1: agent-independent verification entry point + non-provider origins
    (`hook-completion`, `git-backstop`, `ci-backstop`); completion (`Stop`) hook,
    git pre-commit hook, and CI backstop script.
  - C-2: `ac-test-mapping`, `implementation-review`, and `spec-review` computed
    from the traceability map, decision store, and spec-review reports; signals
    that need model judgment escalate as inconclusive instead of passing vacuously.
  - C-3: a decision-pause PreToolUse hook that blocks mutating tools while a
    decision packet is unresolved.
  - C-4: scope-drift in the `change-completeness` gate against the derived spec
    boundary, naming the out-of-scope paths.
  - C-5: the live hooks are generated for hook-capable adapters from one
    definition, with a documented per-adapter coverage matrix.
  - C-6: one machine-readable trust verdict, streamed as a `verification-verdict`
    engine event and written to the verification-evidence artifact.

  No new CLI verb. See `docs/verification-enforcement.md` for the enforcement
  boundary and limitations.

## 1.10.1

### Patch Changes

- [#125](https://github.com/Eliyce/paqad-ai/pull/125) [`6708fd6`](https://github.com/Eliyce/paqad-ai/commit/6708fd6c23609efa48f3a1144527c1b44a2630d4) Thanks [@HLasani](https://github.com/HLasani)! - Rewrite the README and marketing site to make it obvious what paqad-ai is and the problem it solves. The new copy leads with the problem, puts a 30-second install up front, and walks through the framework as a guided tour: one setup for every agent, workflows instead of prompts, deterministic verification, security and design workflows, living documentation, token-efficient context, and local-first enterprise features. The docs site introduction and SEO metadata were updated to match.

## 1.10.0

### Minor Changes

- [#116](https://github.com/Eliyce/paqad-ai/pull/116) [`9f3b0ba`](https://github.com/Eliyce/paqad-ai/commit/9f3b0ba18e6e91f1ea1afa47c8d756a20e46ab54) Thanks [@HLasani](https://github.com/HLasani)! - Engine surface buildout for the desktop app (PQD Engine tickets):
  - PQD-92 (seq 24): Author the engine extension surface contract
  - PQD-95 (seq 27): Set up a project profile and `.paqad/` schema versioning baseline
  - PQD-96 (seq 28): Set up structured logging and log-redaction rules across the three runtimes
  - PQD-98 (seq 29): Hot-register a skill in memory at runtime without restarting
  - PQD-99 (seq 30): Subscribe to engine events through a single unified stream
  - PQD-100 (seq 31): Stream slice execution events so consumers can render progress live
  - PQD-101 (seq 32): Stream decision pause events so consumers can pop the packet UI live
  - PQD-102 (seq 33): Accept extracted text from a vision call into the retrieval index
  - PQD-103 (seq 34): Preview the onboarding file tree without writing anything to disk
  - PQD-104 (seq 35): Cancel every long-running engine call from the consumer side
  - PQD-105 (seq 36): Plug a consumer logger into the engine so all engine logs surface in the consumer
  - PQD-106 (seq 37): Report the engine version and the minimum consumer version it supports
  - PQD-107 (seq 38): Surface a stable error taxonomy that consumers can route to UI behaviours
  - PQD-167 (seq 98): Compute the per-turn context budget breakdown for the active model
  - PQD-169 (seq 100): Generate a rolling summary that preserves speaker attribution
  - PQD-171 (seq 102): Rebuild the API conversation deterministically per turn
  - PQD-172 (seq 103): Tag turn priority and protect decision-packet turns from collapse
  - PQD-174 (seq 105): Index attachments into a session-scoped ephemeral RAG collection
  - PQD-194 (seq 125): Emit skill-load-failed and pack-load-failed audit events
  - PQD-331 (seq 266): Index an attached file into the session or project collection
  - PQD-415 (seq 350): Index, retrieve, and destroy a project-scoped CRS collection through the engine
  - PQD-423 (seq 358): Detect the project stack from a folder (AI-first with static fallback)
  - PQD-424 (seq 359): Run onboarding to generate baseline docs and configs (force-overwrite, opt-in entry files, resume checkpoint, policy guard, schema marker, audit event)

## 1.9.0

### Minor Changes

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: build in small pieces, then reconnect to the whole ([#104](https://github.com/Eliyce/paqad-ai/issues/104))

  Planning now pins the default slice unit to **one acceptance criterion**. On the graduated/full lanes a
  slice that proves no independently-testable criterion is rejected (`SLICE_GRANULARITY_FLOOR`), and a
  slice that bundles several criteria must record why separating them would break the work
  (`SLICE_COMBINE_REASON`, via a new `ExecutionSlice.combine_reason`). The slice executor already takes each
  slice fully through its checks before the next begins; that one-at-a-time ordering is now pinned by test.
  After the slices are built, a new **reconnect check** confirms the assembled pieces fit the _frozen_
  whole-feature spec ([#102](https://github.com/Eliyce/paqad-ai/issues/102)) — every frozen criterion covered and proven, no off-spec or double-owned
  criterion, no unwired cross-slice seam — anchored on the written spec, not the agent's memory. It is a
  real check that fails on an incoherent assembly, structural by default and escalating to an agent
  re-read on the full lane. The fast lane is untouched: trivial work still builds in one step with no
  slicing or reconnect ceremony. Reuses `VerificationCriterion`, `execution_slices`, and the
  plan-vs-actual snapshot — no new acceptance-criterion model and no new slice store.

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: freeze a machine-checkable feature spec and define a single "done" bar before building ([#102](https://github.com/Eliyce/paqad-ai/issues/102))

  Non-trivial features (graduated/full lanes) now require a frozen spec carrying behaviour,
  acceptance criteria (AC-n, given/when/then, proof_type), and human-confirmed invariants (INV-n),
  validated by the new `feature-spec` schema. A spec freezes only with no open questions, no critical
  spec-review defects, and a confirmed invariant set. "Done" becomes a checkable bar — gates pass, every
  acceptance criterion is proven, and no confirmed problem remains; style/taste never blocks. Mid-build
  goal changes and work-vs-spec contradictions pause via the Decision Pause Contract
  (`spec.change` / `spec.contradiction`). The fast lane is unaffected — trivial work needs no spec.

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: keep a passing check meaningful — flaky-test detection, quarantine, and trust ([#106](https://github.com/Eliyce/paqad-ai/issues/106))

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: add a mutation-testing verification gate that plants mutants in the changed code, reports the kill rate and surviving mutants (file/line/operator), and selects the mature per-language tool — marking weak-tooled languages lower-confidence — with full tree-clean safety and per-module score roll-up ([#105](https://github.com/Eliyce/paqad-ai/issues/105))

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: never fix a problem without first proving it exists ([#103](https://github.com/Eliyce/paqad-ai/issues/103))

  A behaviour-affecting fix now follows a four-step protocol — prove broken, fix, prove fixed, prove
  nothing else broke — and the proof is kept as a durable regression guard so the same defect cannot
  silently return. The proof is validated as genuine (re-run against the unfixed tree must fail);
  trivially-passing proofs are rejected. After the fix, the full check set runs and any newly-failing
  previously-passing check rejects the fix, reusing the existing test-output delta projection — no parallel
  result store. Problems that genuinely cannot be auto-checked (timing/appearance) open a single
  `fix.proof_method` Decision Pause, asked once and reused by kind. Proof-first is skipped only for changes
  that cannot affect behaviour (comments, blank lines, docs); when in doubt, the change is treated as
  behaviour-affecting, so the fast lane stays light for cosmetic edits.

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: quality ratchet — record four quality measures at today's real level and only ever allow equal-or-better ([#110](https://github.com/Eliyce/paqad-ai/issues/110))

  Captures tangledness, dead/unused code, risky patterns, and strictness into
  `.paqad/quality-baseline.json` (per module + project), then a verification gate
  refuses any change that worsens a measure — the recorded level only tightens.
  Dead code is consumed from [#109](https://github.com/Eliyce/paqad-ai/issues/109)'s reachability output (one solver, two uses);
  the baseline starts from reality so day one is no clean-up; a legitimate
  regression opens a reused-by-kind `quality.ratchet_exception` Decision Pause.
  The fast lane isn't blocked by measure noise but still cannot loosen the
  baseline.

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: bounded, quiet build-check-fix loop — wrap the single verification pass in lane-scaled rounds with futility detection, keep the round record internal, and emit exactly one honest "stuck" report via the `stop` escalation at the cap ([#108](https://github.com/Eliyce/paqad-ai/issues/108))

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: make sure everything promised got built and nothing extra crept in — bidirectional traceability ([#109](https://github.com/Eliyce/paqad-ai/issues/109))

  Rebuilds a two-way promise ↔ code ↔ test map from reality each run, joining the existing compliance forward link (spec→test), the module map, the import graph, and verification-evidence `ac_id`. Flags promises with no proving check (`TR-UNTESTED-PROMISE`) and code that answers to no promise and that nothing-with-a-promise uses (`TR-CODE-ORPHAN`, decided by reachability over the import graph — not by a label). Shared groundwork passes by _use_; a "this is fine" comment cannot suppress a truly-dead flag. Lane-gated (fast = change-set subset; graduated/full = full build) and written to `.paqad/traceability/map.json`.

- [#114](https://github.com/Eliyce/paqad-ai/pull/114) [`50f9651`](https://github.com/Eliyce/paqad-ai/commit/50f965179d632b444471459ea756fd7885082ac4) Thanks [@HLasani](https://github.com/HLasani)! - feat: sort every finding into four piles before acting — only confirmed, demonstrable problems drive a code change; unclear-spec routes to the spec, false-alarm/taste are recorded, ambiguous opens a `finding.triage` Decision Pause reused by kind ([#107](https://github.com/Eliyce/paqad-ai/issues/107))

## 1.8.1

### Patch Changes

- [#100](https://github.com/Eliyce/paqad-ai/pull/100) [`fda3dd0`](https://github.com/Eliyce/paqad-ai/commit/fda3dd0e64091dd81e20e0ad4c6649e7541369c6) Thanks [@HLasani](https://github.com/HLasani)! - fix([#72](https://github.com/Eliyce/paqad-ai/issues/72)): make `refresh` opt-in and stop shipping generic design-token defaults
  - `paqad-ai refresh` with no target flag is now a status-only no-op. Stack refresh and module-map reconciliation are no longer implicitly on — every target (`--stack`, `--context`, `--providers`, `--rules`, `--reconcile-module-map`) must be requested explicitly, so `refresh` never materializes files the user did not ask for.
  - The design-token seed no longer writes a generic teal/amber brand. It seeds a clearly-marked, neutral placeholder scaffold, and the documentation workflow refuses to derive `design-system/*.md` and theme exports from that placeholder (skipping with a clear "fill in your real tokens" message) instead of generating authoritative-looking docs for a design system that does not exist.

## 1.8.0

### Minor Changes

- [#93](https://github.com/Eliyce/paqad-ai/pull/93) [`752cae8`](https://github.com/Eliyce/paqad-ai/commit/752cae87341b909ed12635db8f07dfc07f5036c5) Thanks [@HLasani](https://github.com/HLasani)! - Overhaul the rule packs shipped into onboarded projects, and add
  `paqad-ai refresh --rules` to regenerate them (issue [#94](https://github.com/Eliyce/paqad-ai/issues/94)).

  **Why.** An audit of every rule under `runtime/**/rules/**` found four problems:
  factually wrong / hallucinated rules (the Laravel `boost.md` invented a "Boost
  module system" that does not exist; two Axum/serde claims in `rust-web` security
  were wrong), rules that duplicated the per-project `module-map.yml`, framework
  plumbing leaking into projects (`.paqad/` paths, phases, lanes, cache metrics),
  and large amounts of non-actionable platitude ("keep X aligned; document when it
  changes").

  **What changed.**
  - **Correctness.** `boost.md` now describes the real Laravel Boost MCP server
    (tools, guidelines, docs API) instead of a fabricated module system. The two
    wrong `rust-web/security` lines are fixed (auth via a `tower` layer / a
    `FromRequestParts` extractor; `#[serde(skip)]` for never-serialized fields).
  - **Every stack rewritten.** All stack and capability rule packs (laravel,
    react, vue, flutter, go-web, rust-web, angular, astro, django, dotnet,
    express, fastapi, flask, nestjs, nextjs, rails, spring-boot, svelte,
    kotlin-android, and the framework/meta-framework capabilities) were rewritten
    to be concrete, framework-accurate, and checkable against a diff. Version-stale
    APIs were corrected (e.g. Tailwind v4 `@theme`/`@source`, Inertia v2
    `optional`/`defer`).
  - **No more `module-map.yml` duplication.** `architecture.md`/`modules.md` now
    point to `docs/instructions/rules/module-map.yml` as the source of truth for
    module ownership instead of restating generic boundary advice.
  - **No framework footprint.** Base and `_shared` rules no longer reference
    `.paqad/`, phases, lanes, handoff, or cache/context metrics; a project can
    delete `.paqad/` with no dangling rule references.
  - **New command.** `paqad-ai refresh --rules` re-resolves the framework rule
    packs for the project's saved stack and rewrites `docs/instructions/rules/`.
    Without `--force` it reports the plan (what would be deleted/written) and makes
    no changes; with `--force` it deletes the previously generated rules and
    rewrites them, preserving the project-owned `module-map.yml` and
    `rule-script-map.yml`.
  - **Guards.** A new `tests/unit/content/rule-quality.test.ts` rejects rule files
    that contain workflow markers (`## Trigger`, `### Step`, `run_id`) or `.paqad/`
    references, so these regressions are blocked. `runtime/rules-authoring.md`
    documents the contract.

  Note: the `design-test`/`design-retest`/`pentest` workflow specs still live under
  `rules/` (the onboarding contract and tests depend on them as generated files);
  relocating them out of the copied rule set is tracked as follow-up and they are
  allowlisted in the guard for now.

### Patch Changes

- [#93](https://github.com/Eliyce/paqad-ai/pull/93) [`752cae8`](https://github.com/Eliyce/paqad-ai/commit/752cae87341b909ed12635db8f07dfc07f5036c5) Thanks [@HLasani](https://github.com/HLasani)! - Relocate the design-system source of truth and label generated outputs (issue
  [#92](https://github.com/Eliyce/paqad-ai/issues/92)). The canonical, hand-edited `design-tokens.json` now lives at
  `docs/instructions/design-system/design-tokens.json` — co-located with the
  Markdown it produces — instead of under `docs/instructions/architecture/`. Each
  generated file (`tokens.md`, `components.md`, `motion.md`, `accessibility.md`,
  `responsive.md`, `patterns.md`) now carries a `GENERATED … do not edit` banner
  pointing back at the source, and the seeded JSON carries a `$comment` declaring
  it the canonical source. This makes it obvious on disk which file to edit and
  which are outputs.

  **`paqad refresh` no longer handles the design system at all.** The
  `--design-system` flag is removed, and a bare `refresh` no longer seeds or
  regenerates design-system docs/theme exports. The design system (the canonical
  `design-tokens.json` and the Markdown generated from it) is owned solely by the
  documentation workflow (`create documentation`). User-facing guidance that
  pointed to `paqad refresh --design-system` (README, the design-system rule, the
  dashboard hint) has been removed accordingly.

  Note: no automatic migration of already-onboarded projects. A project whose
  tokens file is still under `architecture/` should move it to `design-system/`
  manually.

## 1.7.0

### Minor Changes

- [#90](https://github.com/Eliyce/paqad-ai/pull/90) [`71711f0`](https://github.com/Eliyce/paqad-ai/commit/71711f0e6574654cf9826b03a5dcfb24ee3d5aaa) Thanks [@HLasani](https://github.com/HLasani)! - Add **rules-as-scripts** (issue [#89](https://github.com/Eliyce/paqad-ai/issues/89)): turn the prose rules under
  `docs/instructions/rules/**` into deterministic, per-project verification
  scripts that run as a sub-step of `feature-development.checks`, so rule
  adherence no longer depends solely on the model remembering them.

  All prompt-driven — no new user-facing CLI commands:
  - `analyze rules` (`rule-analyzer`) — embeds stable `<!-- @rule RL-<hash> -->`
    markers, classifies each rule `deterministic` / `heuristic` / `unverifiable`,
    detects rules already enforced by ESLint/TS/etc., flags conflicts, and writes
    a reviewable `docs/instructions/rules/rule-script-map.yml`.
  - `generate rule scripts` (`rule-script-generator`) — authors one `.mjs` per
    rule plus synthetic `__fixtures__/{pass,fail}`. A script that misclassifies
    its own fixtures is rejected via the Decision Pause Contract — never
    registered. Strict from generation; per-kind over-flag guard.
  - `feature-development.checks.rule_compliance` runs the registered scripts
    diff-scoped, hash-cached. `deterministic` findings block under `mode: strict`;
    `heuristic` findings route to review and never block. Missing declared
    binaries are reported and skipped, never crash the stage.
  - `add rule` / `edit rule` / `remove rule` / `mark rule as unverifiable`
    (`rule-editor`) — per-rule cascade with stable IDs; no global rebuild.
  - `rule-script-reconciler` surfaces `RS-*` drift (rules edited without regen,
    manual map edits, failing fixtures) at planning entry.
  - New dashboard **Rule Compliance** card; onboarding plants the `analyze rules`
    prompt. Engine exposed as the `paqad-ai/rule-scripts` subpath export.
  - `finding-normalizer` promoted from the security capability to base so its
    cross-capability vocabulary (`PEN-`/`DT-`/`MD-`/`RS-`) is no longer nested
    under one capability.

  Provider-neutral: the same prompt sequence and skills produce identical
  artifacts across every supported adapter.

## 1.6.1

### Patch Changes

- [#87](https://github.com/Eliyce/paqad-ai/pull/87) [`a5e350b`](https://github.com/Eliyce/paqad-ai/commit/a5e350b0d25b4cec7415d78467f624b4e664a1ca) Thanks [@HLasani](https://github.com/HLasani)! - Fix `design test` workflow scripts that failed on every onboarded project:
  - `runtime/scripts/design/scan-tokens.sh` resolved its helper scanner via a
    CWD-relative path, so Step 2 always exited 2 with
    `error: skill scanner missing` when run from anywhere other than the
    runtime root. Now resolves the helper relative to the script's own
    location.
  - `runtime/scripts/design/coverage.sh` aborted under macOS's stock Bash 3.2
    (`set -u` + empty-array expansion) whenever the components directory or a
    component's matching tests were empty — the common first-run case. Guarded
    the three vulnerable `"${arr[@]}"` expansions with the
    `${arr[@]+"${arr[@]}"}` idiom.

  Closes [#86](https://github.com/Eliyce/paqad-ai/issues/86).

## 1.6.0

### Minor Changes

- [#84](https://github.com/Eliyce/paqad-ai/pull/84) [`82d6c45`](https://github.com/Eliyce/paqad-ai/commit/82d6c457b0768e647cddb932547101e4fe45c4d2) Thanks [@HLasani](https://github.com/HLasani)! - feat([#76](https://github.com/Eliyce/paqad-ai/issues/76)): design-test workflow — UI audit against the project's design-system contract

  Adds a heavyweight design-test workflow that mirrors pentest but grades the running UI against `docs/instructions/design-system/*`. Intent-routed (no slash command), resumable, 9 skills + readiness gate, 7 framework-owned runners under `runtime/scripts/design/`, Playwright live phase, `DT-XXXX` finding ids with stable `token | component | state | a11y | responsive | motion | copy | performance | documentation-drift` categories. Companion `design-retest` workflow preserves IDs across re-runs.

  **Workflow**
  - New workflow rules: `runtime/capabilities/coding/rules/design-test.md` + `design-retest.md`.
  - 11 design-test routing triggers at priority 235; 4 design-retest triggers at 245.
  - `feature-development.yaml` splices design-system reads + per-stage instructions through planning → specification → development → review → checks → documentation_sync (schema-conformant via `merge_mode: append`).

  **Skills (the LLM-reasoning layer)**
  - `design-system-coverage` (readiness gate, mirrors `stride-threat-model`), `token-conformance-review`, `component-conformance-review`, `state-coverage-review`, `accessibility-review` (WCAG 2.2 A/AA), `responsive-review`, `motion-review`, `copy-and-ia-review`, `design-system-sync`.
  - **Hard-coded design values** (hex literals, raw `px`/`rem`, ad-hoc font stacks where a token exists) default to **high severity** — first-class findings, not a stylistic preference.

  **Deterministic scripts (the complement to the LLM layer)**

  Per the [agentskills.io](https://agentskills.io) contract: 25 small, focused scripts do the mechanical work so the agent doesn't re-derive it on every run. Each script has `--help`, structured stdout, stderr diagnostics, and meaningful exit codes (0 ok, 1 finding, 2 usage).
  - design-system-coverage: `count-clauses`, `derive-tier`, `gap-report`
  - token-conformance-review: `parse-tokens`, `normalize-color`, `match-leak-to-token`
  - component-conformance-review: `derive-inventory`, `parse-components-md`, `diff-inventories`
  - state-coverage-review: `extract-source-states`, `extract-tested-states`, `cross-reference-states`
  - accessibility-review: `static-a11y-scan`, `parse-axe-violations`, `map-axe-to-wcag`
  - responsive-review: `extract-breakpoints`, `find-horizontal-scroll`, `find-touch-target-violations`
  - motion-review: `scan-animations`, `parse-motion-budget`, `find-reduced-motion-violations`
  - copy-and-ia-review: `extract-user-strings`, `check-action-verbs`, `check-terminology`
  - design-system-sync: `detect-token-additions`, `detect-component-additions`, `propose-tokens-diff`, `propose-components-diff`

  **Framework runners (zero project footprint)**

  `runtime/scripts/design/{scan-tokens, scan-overrides, enumerate-surface, axe-static, coverage, runtime-checks.ts, retest}` — all ship inside paqad-ai; outputs land in the project at `docs/design-test/*` and `.paqad/design-test/runs/*` as work products. Diverges from pentest's project-seeded runner model intentionally; the divergence is documented in the workflow rule.

  **Finding normalizer**

  `DT-` code prefix, design-test category vocabulary, `blocker | nit` severities + `accepted | waived | still-open | needs-manual-verification` statuses.

  **Tests**

  ~200 fixture-driven test cases under `tests/unit/skills/` + `tests/fixtures/design-skills/<skill>/`. The `coverage-completeness` meta-test enforces that every script is referenced by basename in its spec, passes `bash -n`, and that every backticked path in each `SKILL.md` Resources section exists on disk.

  **Skill-authoring rule**

  `docs/instructions/rules/_shared/skill-authoring.md` captures the contract for future skills — anatomy, frontmatter, the deterministic-vs-judgment boundary, the script interface contract, portability workarounds (no `mapfile`, no `\b` in awk, BSD grep alternation quirk, missing-trailing-newline guard), and the testing rules. Auto-loaded by the framework entry, so future skills inherit the contract without being told.

## 1.5.0

### Minor Changes

- [#82](https://github.com/Eliyce/paqad-ai/pull/82) [`f330595`](https://github.com/Eliyce/paqad-ai/commit/f330595d38c5e66afc54443daefe9e4f97a7ea68) Thanks [@HLasani](https://github.com/HLasani)! - Living module lifecycle: prospective decisions, retrospective reconciliation, test-driven health, dashboard drift checks (closes [#80](https://github.com/Eliyce/paqad-ai/issues/80))

## 1.4.0

### Minor Changes

- [#75](https://github.com/Eliyce/paqad-ai/pull/75) [`283d973`](https://github.com/Eliyce/paqad-ai/commit/283d9736621e7571013a377408a8ec6416b54df9) Thanks [@HLasani](https://github.com/HLasani)! - Gate every agent turn on the entry-file load, not just code-mutating tool
  calls. Onboarded projects previously could answer read-only prompts (Q&A,
  "what is this project", explanations) without loading `CLAUDE.md`,
  `.paqad/framework-path.txt`, or `docs/instructions/{rules,stack,design-system}`
  — the framework's rules and Decision Pause Contract silently never entered
  context.

  The Claude Code adapter now installs a `UserPromptSubmit` hook
  (`runtime/hooks/agent-entry-prompt-gate.sh`) alongside the existing
  `PreToolUse` hook. Both gates share sentinel-freshness logic via
  `runtime/hooks/lib/agent-entry-sentinel.sh` so they cannot drift.

  Soft mode (default): the hook prints a high-priority reminder on stdout; Claude
  Code injects it into the model context before the turn is planned. Hard mode
  (`PAQAD_AGENT_ENTRY_MODE=hard`): the hook exits non-zero and blocks the turn
  until the sentinel is written.

  Re-running onboarding / `paqad upgrade` refreshes the wiring in
  `.claude/settings.json` idempotently. Resolves Eliyce/paqad-ai#74.

## 1.3.0

### Minor Changes

- [#67](https://github.com/Eliyce/paqad-ai/pull/67) [`c4312aa`](https://github.com/Eliyce/paqad-ai/commit/c4312aab1366c6c25138e6de38cff935c862ccb1) Thanks [@HLasani](https://github.com/HLasani)! - Add `paqad-ai dashboard` and `paqad-ai status` — the living single-pane health overview for an onboarded paqad project.

  `paqad-ai dashboard` starts a local web server (port 5372, auto-incrementing) on the same bundle as `paqad-ai graph`. The graph view is now one section inside the dashboard, opened via the architecture card; the existing `paqad-ai graph` command is unchanged and is still a direct shortcut to the graph route. Sections rendered in Phase 1: project profile, rules, workflows, decisions (living), module health (living), module docs, architecture, design system, stack, registries, tools, tech-debt, stack drift, framework version, RAG status, and — when present — pentest and session continuity. Each card shows a score badge, a one-line state-derived summary, a `?` helper popover, and up to three compact metrics. Score is existence + freshness only (file present + last-modified ≤ 30d = 100%, decays linearly to 0 at the 180d cliff); no content-quality heuristics in Phase 1. The summary band surfaces up to five "Needs your attention" items, critical-first. The card border pulses (200ms accent) when SSE re-fetch updates a section — the one allowed animation.

  `paqad-ai status` is the same `buildReport()` pipeline, but one-shot — no server, no long-running process. Defaults to a deterministic Markdown rendering for humans / PR descriptions; `--format json` emits the stable `schemaVersion: 1` contract for agent prompts.

  Zero install footprint: the bundle ships inside the package (mirroring the existing `runtime/graph-ui/` pattern), no new files are written into the user's project, scoring is computed on the fly, and no new MCP server or background process is introduced. Reuses every `--color-mod-*` design token already present in `graph-ui/src/index.css` — no new design tokens.

  Closes [#64](https://github.com/Eliyce/paqad-ai/issues/64).

### Patch Changes

- [#71](https://github.com/Eliyce/paqad-ai/pull/71) [`c530fa3`](https://github.com/Eliyce/paqad-ai/commit/c530fa34d032f7f454f49386bc66987e32cb726a) Thanks [@HLasani](https://github.com/HLasani)! - Stop leaking absolute install paths into committed onboarding artifacts ([#69](https://github.com/Eliyce/paqad-ai/issues/69)). The hooks manifest (`.claude/settings.hooks.json`, `.codex/hooks.json`, `.gemini/hooks.json`, etc.) now stores only the package-relative `source` and resolves the hook script at runtime, instead of baking in `/opt/homebrew/lib/node_modules/paqad-ai/...` or `~/.npm/_npx/<hash>/...` from the onboarding user's machine. A teammate cloning the repo (different OS user, different package manager, Mac vs. Windows) can now run Paqad without every hook 404'ing, and usernames/machine layout no longer end up in source control. Adds a portability test that scans all generated config across every adapter × fixture combination for leaked absolute paths.

## 1.2.1

### Patch Changes

- [#65](https://github.com/Eliyce/paqad-ai/pull/65) [`f398b00`](https://github.com/Eliyce/paqad-ai/commit/f398b00ced1d676a5e35452a3da7d143431569a0) Thanks [@HLasani](https://github.com/HLasani)! - Fix `paqad-ai onboard` hanging on the RAG "No, skip" path at the end of the full interactive prompt chain.

  The orchestrator previously interleaved the RAG inquirer prompt with file writes: `resolveRagSelection()` ran early, and `writeDetectionReport` / `writeFrameworkMetadata` / `writeOnboardingManifest` / `writeDecisionPauseContractDocument` / `compileRules` / `initializeModuleHealth` / `classifier-config.json` / `next-steps.md` all ran _after_ it. When inquirer left a stuck readline handle on Node's event loop — observed reliably with the full prompt chain on the No-skip branch — every post-RAG write was silently dropped. Users were left with an incomplete `.paqad/**` and no `ONBOARDING COMPLETE` banner.

  Onboarding is now two-phase. Phase 1 writes every core `.paqad/**` artifact and `CLAUDE.md`-equivalents with no inquirer prompts in the path. The new `onPhase1Complete` callback fires only after the onboarding manifest is on disk, so the success banner prints before phase 2 begins. Phase 2 owns the RAG opt-in (prompt → optional index build → idempotent `writeProjectProfile` update). If phase 2 prompts, hangs, fails, or is interrupted, every phase 1 artifact is already durable on disk.

  Adds three orchestrator invariant unit tests that pin the new contract (`onPhase1Complete` fires after all core artifacts exist; a thrown `RagService.configureAndBuild` does not drop core writes; a thrown `resolveRagSelection` does not drop core writes) and a PTY-driven E2E (gated on the system `expect(1)` binary, skipped on platforms without it) that drives the real built CLI through the full interactive Laravel prompt chain, picks "No, skip" on RAG, and asserts the complete `.paqad/**` artifact set on disk.

  Closes [#62](https://github.com/Eliyce/paqad-ai/issues/62).

## 1.2.0

### Minor Changes

- [#60](https://github.com/Eliyce/paqad-ai/pull/60) [`2e35581`](https://github.com/Eliyce/paqad-ai/commit/2e355817f14792fc51b7beada9001f96eaac4b13) Thanks [@HLasani](https://github.com/HLasani)! - **[#37](https://github.com/Eliyce/paqad-ai/issues/37) — Decision Pause Contract: ship the full resolution flow to every provider via one managed external doc**
  - Onboarding now writes a canonical `.paqad/decision-pause-contract.md` (rule, categories sourced from `DECISION_CATEGORIES`, four-step resolution flow, per-adapter UI table, file-wait fallback) — re-runs are byte-identical when nothing changed.
  - Every provider entry file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/…`, `.windsurf/rules/…`, `GEMINI.md`, `.junie/AGENTS.md`, `ANTIGRAVITY.md`, `.github/copilot-instructions.md`, `.continue/…`, `.aider.conf.yml`) now renders a thin pointer + a one-sentence per-adapter UI note (Claude Code → `AskUserQuestion`, Aider → `/ask`, etc.) from the new `decision-pause-ui-shim`.
  - `paqad refresh --providers` re-renders entry files for adapters whose config exists on disk and rewrites the managed doc; it intentionally does not silently onboard new providers.
  - Health check now compares each entry against its adapter's expected rendering and warns when the managed doc is missing, with a remediation hint pointing at `paqad refresh --providers`.

  **[#42](https://github.com/Eliyce/paqad-ai/issues/42) — `ticket_intake` + `delivery` bookend stages with priors-first decision elicitation**
  - New stage order: `ticket_intake → planning → specification → development → review → checks → documentation_sync → delivery`. Both bookends are framework-owned and project-overridable via the existing `merge_mode: append` mechanism; the JSON schema rejects unknown keys with `additionalProperties: false`.
  - New optional top-level `conventions:` block on the project profile covering `ticket / intake_decisions / branch / commit / pr`. `DEFAULT_CONVENTIONS` is the runtime source of truth; `resolveConventions` shallow-merges project overrides per section so every field is populated for downstream consumers.
  - `mcp.servers[]` gains an optional `kind` discriminator (`jira | linear | github-issues | generic`); existing servers without `kind` keep validating.
  - Four new `DECISION_CATEGORIES`: `intake.requirement`, `intake.confirm_auto_resolution`, `intake.write_back`, `delivery.open_pr`. All ride the existing pending → resolved lifecycle, audit log, and TTL machinery.
  - `findIntakePriorMatch` is the dedicated priors-first entrypoint for intake; it computes the fingerprint and reuses the existing `DecisionStore.findReusableDecision` machinery, which already emits `decision-reused` audit events on every hit.
  - New batched-confirm primitive (`BatchedConfirmRequest`, `applyBatchedAnswer`, `renderBatchedRow`) backs `intake.confirm_auto_resolution`. Single-packet flow remains the default for every other category.
  - New `src/delivery/` modules: `templates.ts` renders branch / commit / pr_title / pr_body from the conventions block + inputs (slugify, conventional type mapping, `{placeholder}` substitution); `host.ts` detects the delivery host (GitHub today, GitLab / Bitbucket recognised); `runner.ts` sequences `git checkout -b → git commit → git push → gh pr create` through a dependency-injected `DeliveryShell` so unit tests don't touch a real remote. Every failure short-circuits with an actionable remediation hint — no silent local-only fallback.
  - Default PR body template at `runtime/templates/pr-body.md.hbs`; projects can override with `.paqad/templates/pr-body.md`.
  - Module docs: `docs/modules/decision-pause-contract/managed-doc-architecture.md` and `docs/modules/feature-development-workflow/ticket-intake-and-delivery.md`.

## 1.1.0

### Minor Changes

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Add a harness-enforced agent-entry gate so onboarded Claude Code projects can't silently bypass `CLAUDE.md` ([#34](https://github.com/Eliyce/paqad-ai/issues/34)). Onboarding now writes `.claude/settings.json` with two hooks:
  - `PreToolUse` on `Edit|Write|NotebookEdit` runs `runtime/hooks/agent-entry-gate.sh`, which blocks the call with exit code 2 unless `.paqad/.agent-entry-loaded` exists and is newer than `CLAUDE.md`, `.paqad/framework-path.txt`, and everything under `docs/instructions/`.
  - `SessionStart` runs `runtime/hooks/agent-entry-session-start.sh`, which deletes the sentinel so every new session starts ungated.

  The CLAUDE.md template now instructs the agent to write the sentinel after loading the framework entry, and to re-load when the gate invalidates it. Existing settings.json keys and pre-existing hook entries are preserved on merge, and re-running onboarding is idempotent (no duplicate gate entries). Read-only tools (Read, Grep, Glob, status-only Bash) remain available pre-gate so the agent can satisfy it. AGENTS.md and other providers can re-use the same scripts in follow-ups via `PAQAD_ENTRY_FILE`.

### Patch Changes

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Make onboarding re-runs idempotent ([#27](https://github.com/Eliyce/paqad-ai/issues/27)): when `.paqad/detection-report.json`, `.paqad/onboarding-manifest.json`, and `.paqad/framework-version.txt` would otherwise be byte-identical apart from their embedded timestamp, the writer now reuses the existing timestamp instead of stamping a fresh one. A no-op re-run produces zero diff; any real change still bumps the timestamp. Fixes the Windows-CI `is idempotent across repeated onboarding runs` failure (timing luck was hiding the same bug on macOS/Linux).

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - `paqad-ai refresh` now self-heals when `docs/instructions/architecture/design-tokens.json` is missing ([#56](https://github.com/Eliyce/paqad-ai/issues/56)). The design-system step seeds default tokens via the existing idempotent `DesignTokenService.seed()` before generating docs and theme exports, so `--stack` and `--context` sub-refreshes no longer get aborted by an unhandled `ENOENT`. `DesignTokenService.load()` now translates a missing file into a typed `DesignTokensMissingError` with an actionable message; invalid (but present) files still surface the existing validation error.

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Stop emitting the hardcoded `Categories:` block in provider entry files ([#54](https://github.com/Eliyce/paqad-ai/issues/54)). `buildDecisionPauseContractSection()` now renders just the Decision Pause Contract paragraph — no `Categories:` heading, no fixed five-item bullet list. `extractDecisionPauseContractSection` still parses entry files that previously contained the block (back-compat), and the existing drift health check flags the legacy block so re-running onboarding / refresh strips it from already-onboarded projects.

- [#58](https://github.com/Eliyce/paqad-ai/pull/58) [`195ae7d`](https://github.com/Eliyce/paqad-ai/commit/195ae7dbca635305e8a3aaff9fb08f0af72e9cbc) Thanks [@HLasani](https://github.com/HLasani)! - Cross-platform output consistency: normalize path strings to forward slashes at more production output boundaries — DocumentationWorkflow generated/skipped arrays and handover_path, onboarding orchestrator manifest writes and return values, `saveObligationIndex` return, registry-generator source_paths (both native-module and signal-extracted), and the project-question phase write target. Fix `slugifySpec` to split on both `/` and `\\` so spec-indexed compliance paths derive correctly on Windows. Rewrite `sanitizePersistedPath` to avoid relying on `process.cwd()` for relative inputs. Drops the Windows CI failure count from 15 → 11 test files ([#41](https://github.com/Eliyce/paqad-ai/issues/41)).

## 1.0.7

### Patch Changes

- [#55](https://github.com/Eliyce/paqad-ai/pull/55) [`d47cf96`](https://github.com/Eliyce/paqad-ai/commit/d47cf964d0c661c8369e7f69c374df02ef84a8c9) Thanks [@HLasani](https://github.com/HLasani)! - Cross-platform output consistency: normalize path strings to forward slashes at more production output boundaries — DocumentationWorkflow generated/skipped arrays and handover_path, onboarding orchestrator manifest writes and return values, `saveObligationIndex` return, registry-generator source_paths (both native-module and signal-extracted), and the project-question phase write target. Fix `slugifySpec` to split on both `/` and `\\` so spec-indexed compliance paths derive correctly on Windows. Rewrite `sanitizePersistedPath` to avoid relying on `process.cwd()` for relative inputs. Drops the Windows CI failure count from 15 → 11 test files ([#41](https://github.com/Eliyce/paqad-ai/issues/41)).

## 1.0.6

### Patch Changes

- [#38](https://github.com/Eliyce/paqad-ai/pull/38) [`c7aac12`](https://github.com/Eliyce/paqad-ai/commit/c7aac120bc503cf5122a8205c28c54506c96730f) Thanks [@HLasani](https://github.com/HLasani)! - Internal code-quality cleanup: remove 13 dead-store assignments flagged by `@eslint/js` v10's `no-useless-assignment` rule, and attach the original error as `cause` when wrapping decision-pause write failures so callers can inspect the underlying I/O error via `error.cause`.

- [#39](https://github.com/Eliyce/paqad-ai/pull/39) [`26bde79`](https://github.com/Eliyce/paqad-ai/commit/26bde79c651b7809de65469a5ac8fb23c9e20675) Thanks [@HLasani](https://github.com/HLasani)! - Upgrade TypeScript from 5.9.x to 6.0.x. Adds `ignoreDeprecations: "6.0"` to `tsconfig.json` to silence the `baseUrl`-deprecation warning emitted by `tsup`'s internal dts build pipeline (TS 7.0 will remove `baseUrl` entirely; tsup needs to drop its internal use before then).

## 1.0.5

### Patch Changes

- [#35](https://github.com/Eliyce/paqad-ai/pull/35) [`c8f7f03`](https://github.com/Eliyce/paqad-ai/commit/c8f7f03c60f4149579b4f3fb1c3c89be21c77811) Thanks [@HLasani](https://github.com/HLasani)! - Normalize generated path strings to forward slashes at more production output boundaries for cross-platform consistency ([#30](https://github.com/Eliyce/paqad-ai/issues/30), [#33](https://github.com/Eliyce/paqad-ai/issues/33)). Retry `runScript` once on transient bash-subprocess failures ([#25](https://github.com/Eliyce/paqad-ai/issues/25)). Skip Windows-incompatible tests in CI excludes and align timeouts ([#28](https://github.com/Eliyce/paqad-ai/issues/28)).

## 1.0.4

### Patch Changes

- [#21](https://github.com/Eliyce/paqad-ai/pull/21) [`8bc2642`](https://github.com/Eliyce/paqad-ai/commit/8bc2642c3af5f0af5dfc569507544c092b891503) Thanks [@HLasani](https://github.com/HLasani)! - Read `VERSION` constant dynamically from `package.json` at module load instead of hardcoding it. Future releases no longer need a manual `src/index.ts` edit to keep the exported constant in sync with the published version. Closes [#18](https://github.com/Eliyce/paqad-ai/issues/18).

## 1.0.3

### Patch Changes

- [#15](https://github.com/Eliyce/paqad-ai/pull/15) [`99b1e5b`](https://github.com/Eliyce/paqad-ai/commit/99b1e5b18f42634006f88e16c7eb2fc7091d3f43) Thanks [@HLasani](https://github.com/HLasani)! - First automated release via Changesets + GitHub Actions. No runtime change — this release exists only to validate the new publish pipeline (CI gating, version PR, npm provenance).

All notable changes to this project will be documented in this file. See [Changesets](https://github.com/changesets/changesets) for commit guidelines.
