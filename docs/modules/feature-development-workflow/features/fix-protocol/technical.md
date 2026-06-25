# Fix Protocol — Technical

> **Slug:** `fix-protocol` &nbsp;·&nbsp; **Issue:** #103

## Source footprint

| Concern | Location |
|---|---|
| Protocol types | `src/core/types/fix-protocol.ts` |
| Behaviour classifier | `src/fix-protocol/affects-behaviour.ts` |
| Proof genuineness + pass checks | `src/fix-protocol/proof.ts` |
| Green baseline + regression detection | `src/fix-protocol/baseline.ts` |
| Regression-guard registry | `src/fix-protocol/regression-guard.ts` |
| `fix.proof_method` decision packet | `src/fix-protocol/fix-proof-method-decision.ts` |
| Orchestrator (prove→fix→prove→regression) | `src/fix-protocol/fix-protocol.ts` |
| Decision category | `src/planning/decision-packet.ts` (`fix.proof_method`) |
| Guard storage path | `src/core/constants/paths.ts` (`REGRESSION_GUARDS_DIR`) |

## The four steps

`runFixProtocol()` is pure orchestration over injected, tool-agnostic effects
(`runProofOnUnfixedTree`, `applyFix`, `runProofOnFixedTree`, `runFullSuiteAfterFix`), so the ordering is
enforced — `applyFix` runs only after the proof is proven genuine on the unfixed tree:

1. `affectsBehaviour(change)` gates the protocol. If the change cannot affect behaviour, the fix is
   applied and the protocol returns `skipped-no-behaviour-change` (no proof, no suite run).
2. The proof runs on the **unfixed** tree; `assessProofGenuineness()` requires a genuine failure (and,
   if `expected_failure_signal` is set, that the failure targets the reported defect). A non-genuine
   proof returns `rejected-proof-not-genuine` **without applying the fix**.
3. After `applyFix()`, `proofPassesAfterFix()` requires the once-failing proof to pass, else
   `rejected-proof-still-failing`.
4. `detectRegression(baseline.issues, afterFix)` compares the post-fix suite to the green baseline using
   the existing `createTestDelta` projection — **no parallel result store**. Any newly-failing or
   newly-errored check returns `rejected-regression`. The once-failing proof never counts (it surfaces
   as `newly_passing`).

On success the proof is persisted and the result is `fixed`.

## The behaviour classifier

`affectsBehaviour()` is deliberately narrow. A change is non-behaviour-affecting only when every changed
line is a blank line, a full-line comment (per the file's language), or a C-style block-comment
delimiter line — or the file is a documentation file (`.md`, `.txt`, `.rst`, …). Unknown file types,
code lines, comment markers from another language, and files with no recorded line detail all default to
**behaviour-affecting** (issue #103: when in doubt, treat as behaviour-affecting). The verdict carries
`behavioural_evidence` so each non-skip is logged.

## The green baseline (open decision #1)

`resolveGreenBaseline()` reuses the last passing `verification-evidence` summary when the working tree is
unchanged (`reused-evidence`), and otherwise re-runs the suite (`rerun`). A missing/failing evidence, or
a tree that changed since the evidence, always forces a re-run.

## Keeping the proof

`writeRegressionGuard()` persists `.paqad/regression-guards/<defect_id>.json` (atomic temp-file +
rename) linking a stable `defect_id` to its committed proof test and the captured failing evidence
(reusing the `VerificationEvidenceFailure` shape). `defect_id` is validated as a filename-safe slug to
prevent path traversal. The committed test stays in the suite (permanence); the registry entry is the
`defect_id ↔ test` link (open decision #3: both).

## Un-checkable problems → ask once, remember by kind

`buildFixProofMethodPacket()` produces a `fix.proof_method` Decision Packet whose options are stable per
call and whose fingerprint is keyed by *kind* (not the specific defect). A later same-kind case is
matched by the shipped `DecisionStore.findReusableDecision()` (exact fingerprint or fuzzy option overlap
≥ 0.8), reusing the saved answer and emitting `decision-reused` — it does not build a second memory. The
category is documented in the Decision Pause Contract, carried by the framework bootstrap (`AGENT-BOOTSTRAP.md`).

## Honest dependency

A proof is only as trustworthy as the suite that runs it. This feature does not judge test strength —
that is mutation testing (#105) and flaky-test detection (#106).
