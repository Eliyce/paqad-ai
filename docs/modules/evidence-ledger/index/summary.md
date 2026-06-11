# Evidence Ledger & Provenance Receipt

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `evidence-ledger` &nbsp;·&nbsp; **Issue:** #118

## Purpose

paqad already runs 16 verification gates plus standalone correctness engines, and
several of them write append-only audit trails — but each logs in isolation and
**the proof is discarded at merge.** The market's real pain is not "trust the
vendor," it's "trust *this change*," and no AI coding tool emits per-change
correctness provenance. This module fixes both halves of that gap: one **unified
evidence ledger** every engine writes to, and a **per-change provenance receipt**
(an AI-BOM) projected from it at merge time.

## The load-bearing rule — grade the evidence

A receipt that says "12/16 gates passed" is theater. A receipt that says
"**8 deterministic** gates passed, **3 LLM-judged** gates passed, **1 ratchet
measure blocked**, **1 inconclusive**" is provenance. Every ledger row therefore
carries a `strength_class`:

| Tier | `strength_class` | Meaning | Examples |
| ---- | ---------------- | ------- | -------- |
| A | `deterministic` | a computed, reproducible measure | mutation, ratchet, traceability, ac-test-mapping, lint/tests |
| B | `llm-judged` | a verdict produced by a model judgment | spec-review, implementation-review, story-quality, requirement-completeness |
| C | `blocked` | no evidence — measure unavailable or inconclusive | ratchet `blocked` sample, an inconclusive gate |

Deterministic and LLM-judged passes are counted separately and **never pooled**;
blocked / inconclusive rows downgrade the result rather than hiding inside a pass
total. `src/evidence/grading.ts` is the single source of truth for the A/B split.

## How it works

| Step | Where |
| ---- | ----- |
| Grade a gate result (Tier A/B/C → verdict + strength) | `src/evidence/grading.ts` (`gradeGateResult`, `GATE_STRENGTH_TIER`) |
| Per-file digests + one order-independent change subject | `src/evidence/digests.ts` (`computeFileDigests`, `computeChangeSubjectDigest`) |
| Append-only JSONL ledger + tolerant reader + `content_hash` dedup | `src/evidence/ledger.ts` (`appendEvidenceRows`, `readEvidenceLedger`, `computeRowContentHash`) |
| Fan engine output into rows (gates, ratchet measures, findings) | `src/evidence/fan-in.ts` (`gateResultsToRows`, `ratchetResultToRows`, `findingRowsFrom`) |
| in-toto Statement (v1) + SLSA-VSA-modelled predicate | `src/evidence/receipt/statement.ts` (`buildInTotoStatement`, `summarizeGradedEvidence`) |
| DSSE envelope + hash-chain signing + chain verification | `src/evidence/receipt/dsse.ts` (`signReceipt`, `verifyReceiptChain`, `pae`) |
| CycloneDX-adjacent AI-BOM view | `src/evidence/receipt/ai-bom.ts` (`buildAiBom`) |
| Project + persist the receipt at merge | `src/evidence/receipt/project.ts` (`projectReceipt`) |
| Wired into the merge-time backstop | `src/verification/repository/run-repository-verification.ts` |

## On-disk layout

| Path | What |
| ---- | ---- |
| `.paqad/ledger/evidence.jsonl` | the unified append-only ledger (one graded row per line) |
| `.paqad/ledger/receipt.dsse.json` | the latest signed receipt (DSSE envelope wrapping the in-toto Statement) |
| `.paqad/ledger/receipts.jsonl` | the tamper-evident receipt **chain** (one envelope per line) |
| `.paqad/ledger/ai-bom.json` | the CycloneDX-adjacent AI-BOM view |

## Subject identity (resolved decision)

in-toto's `subject` wants per-artifact digests; a change spans many files. We
resolve it in favour of **per-file digests**: the receipt carries one in-toto
subject per changed file, while every ledger row is stamped with a single
`subject_digest` that is a stable, order-independent hash *over* those per-file
digests. Rows share one change identity; the receipt keeps full granularity.

## Signing — honest local-first degradation

Sigstore keyless (Fulcio/Rekor) assumes a CI OIDC identity and a public
transparency log, so it only works in CI. Locally there is no third party to
anchor a signature, so **"signed" degrades — explicitly — to a tamper-evident
hash chain**: each receipt embeds the SHA-256 of the previous receipt's PAE, so
any retroactive edit to an earlier receipt breaks every later link
(`verifyReceiptChain` returns the first broken index). The signing *mode* is
detected from the environment (`detectSigningMode`), but the local signer never
dresses the hash chain up as a third-party signature — `signing_mode` records
the truth.

## Boundaries

- **Owns:** the unified ledger and the merge-time receipt projected from it.
- **Does not own:** making gates fire from hooks (issue #117, the binding layer
  this builds on); the human-readable PR-comment renderer; agent/model
  attestation; gate→legal-clause mapping; the context-replay stamp; SIEM export.
- The gate and quality-ratchet fan-in is wired at the merge-time backstop.
  Traceability (`TR-*`), pentest (`PT-*`), and triage findings share the same
  schema via `findingRowsFrom` and are emitted by their own engines.
