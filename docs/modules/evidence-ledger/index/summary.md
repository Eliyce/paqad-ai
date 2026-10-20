# Evidence Ledger & Provenance Receipt

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `evidence-ledger` &nbsp;·&nbsp; **Issues:** #118, #120

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
blocked and inconclusive rows are counted on their own rather than hiding inside a pass
total. Only an inconclusive row downgrades the receipt's result to Inconclusive. A blocked
row is a measure that could not be taken, such as a quality measure with no coverage report.
It stays listed in the receipt's `blocked` count but no longer changes the result (issue
#669, decision D-01M5A0MG6537XJ7S3MD3Q4PSCR). A real `fail` still reads Failed.
`src/evidence/grading.ts` is the single source of truth for the A/B split.

A row's `verdict` is one of `pass`, `fail`, `inconclusive`, `blocked` or `skipped`
(issue #579). `skipped` records a gate that measured nothing, such as the visual-evidence
gate on a change with no frontend files. Since issue #639 (Part 10) a skipped row also
carries `skip_kind`: `not-required` when the change gave the gate nothing to check, or
`did-not-run` when a check it was owed did not happen. `skip_kind` is not part of the
identity hash. A skipped row is counted as neither a pass nor a fail in the graded summary,
and it never becomes a compliance citation (only `pass` rows do).

## How it works

| Step | Where |
| ---- | ----- |
| Grade a gate result (Tier A/B/C → verdict + strength) | `src/evidence/grading.ts` (`gradeGateResult`, `GATE_STRENGTH_TIER`) |
| Per-file digests + one order-independent change subject | `src/evidence/digests.ts` (`computeFileDigests`, `computeChangeSubjectDigest`) |
| Append-only JSONL ledger + tolerant reader + `content_hash` dedup | `src/evidence/ledger.ts` (`appendEvidenceRows`, `readEvidenceLedger`, `computeRowContentHash`) |
| Fan engine output into rows (gates, ratchet measures, findings) | `src/evidence/fan-in.ts` (`gateResultsToRows`, `ratchetResultToRows`, `findingRowsFrom`; `evidenceGatesToRows` for the late bundle-completeness / visual-evidence / rules-loaded gates, issue #579) |
| in-toto Statement (v1) + SLSA-VSA-modelled predicate | `src/evidence/receipt/statement.ts` (`buildInTotoStatement`, `summarizeGradedEvidence`) |
| DSSE envelope + hash-chain signing + chain verification | `src/evidence/receipt/dsse.ts` (`signReceipt`, `verifyReceiptChain`, `pae`) |
| CycloneDX-adjacent AI-BOM view | `src/evidence/receipt/ai-bom.ts` (`buildAiBom`) |
| Project + persist the per-feature receipt at merge | `src/feature-evidence/receipt.ts` (`projectFeatureReceipt`, `latestFeatureReceipt`); `latestReceiptAuthorship` in `src/evidence/receipt/project.ts` reads the latest bundle receipt |
| Resolve change authorship (agent/model/provider/human) | `src/evidence/receipt/authorship.ts` (`resolveChangeAuthorship`, `buildChangeAuthorship`) |
| Wired into the merge-time backstop | `src/verification/repository/run-repository-verification.ts` |

## On-disk layout

Issue #468 (finishing #339) moved the evidence home into the per-feature bundle. The
graded rows, the signed receipt, and the AI-BOM now live inside each change's
`.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/` directory; the retired top-level
`.paqad/ledger/{evidence.jsonl,receipt.dsse.json,receipts.jsonl,ai-bom.json}` writes are
gone (every reader projects the whole-project view from the bundle union). The receipt is
no longer a single cross-feature hash chain — each bundle carries its own sealed snapshot,
verified independently with `verifyReceiptSeal`.

Issue #581 made `evidence.jsonl` always on: every change records one row per gate that ran,
whatever the enterprise toggles. Only `receipt.json` and `ai-bom.json` stay enterprise
capabilities. The receipt no longer copies the rows. Its predicate carries
`evidence_sha256` (the SHA-256 of `evidence.jsonl` at seal time) and `evidence_line_count`,
plus the graded counts and the verdict. Since issue #669 the end-of-turn run seals the receipt
after every gate and before it builds the verdict, so a receipt it writes covers every row of
that run. A later run appends
after the seal, so `verifyEvidenceSeal` re-hashes only the first `evidence_line_count` lines. Readers get a
receipt's rows through `receiptEvidenceRows` (`src/feature-evidence/receipt.ts`): the
`evidence.jsonl` rows of that run for a sealing receipt, `predicate.rows` for one sealed
before #581. The whole-project receipt still carries its rows.

Each bundle row also carries the one envelope header (issue #581): `appendFeatureEvidenceRows`
re-stamps a graded row with `doc_type` `paqad.evidence`, `change` (the folder-name ULID),
`session_id`, `recorded_at` (the row's own time, which a sealing receipt's `time_verified`
names) and a row `content_hash`, and no longer writes `ts`. `readEvidenceRowsAt` accepts
either time field and returns the one row view with `ts` filled in, without rewriting the
sealed bytes. The bundle `receipt.json` carries the header in its top-level `paqad` block,
outside the signed payload (`content_hash` is the `receipt_hash`; `time_verified` stays in
the payload), and the bundle `ai-bom.json` carries it as `paqad:<field>` entries at the front
of `metadata.properties`.

| Path | What |
| ---- | ---- |
| `.paqad/ledger/feature-evidence/<feature>/evidence.jsonl` | the change's graded rows (one per line), always written |
| `.paqad/ledger/feature-evidence/<feature>/receipt.json` | the change's signed receipt (DSSE envelope wrapping the in-toto Statement), sealed independently; seals `evidence.jsonl` by hash and line count |
| `.paqad/ledger/feature-evidence/<feature>/ai-bom.json` | the CycloneDX-adjacent AI-BOM view |
| `.paqad/session/context-stamp.json` | the latest reproducibility stamp (relocated out of `.paqad/ledger/`) |

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

## Change authorship — the neutral, cross-agent attestation (#120)

paqad's correctness signal is **gate-derived** (tests/mutation/traceability), not
agent-derived, so paqad can vouch for a change **regardless of which AI tool wrote
it**. No single-vendor tool can occupy that seat: every competitor scopes trust to
its own output, and cross-vendor provenance formats (`agent-trace`, `git-ai`)
record *who wrote it* but explicitly do not evaluate quality or capture a human
accepter. #120 captures the missing authorship dimension and folds it into the
same signed receipt, so the attestation stays **gate-derived yet
producer-attributed**.

The provenance is honestly graded:

| Field | Source | Trust |
| ----- | ------ | ----- |
| `agent` | the onboarded adapter (one of the 11 `AdapterType` values) | a **known fact** from the manifest |
| `model` / `provider` / `model_id` | declared via env (`PAQAD_MODEL_ID` = `provider/model`, or `PAQAD_AGENT_MODEL` / `PAQAD_AGENT_PROVIDER`) | **declared**, not self-verified — an adapter knows it is "cursor" but Cursor routes to many models; `provenance: 'declared'` says so |
| `accepting_human` | git identity (`user.name` / `user.email`) | the same name/email git already records; suppressible with `PAQAD_NO_HUMAN_ATTESTATION=1` |

Field names mirror the cross-vendor `agent-trace` convention (`model_id` =
`provider/model`) so the record **interoperates** with that ecosystem rather than
competing with it. Authorship is folded into the VSA predicate (and so into the
hash-chained signature), flattened into `paqad:authorship:*` AI-BOM properties,
rendered as a one-line PR-comment footer, and summarised in the dashboard's
**Attestation** section. When no authorship resolves, the field is omitted
entirely so prior receipts stay byte-identical.

> **Privacy:** `.paqad/ledger/` is git-ignored (shared via the dashboard/SIEM,
> never committed), so `accepting_human` does not land in the repo history. It is
> the same identity git already stores in every commit, so it adds no new
> disclosure; the env opt-out drops it, and the public PR comment shows the name
> only (never the email).

## Why the code works the way it does

The reasons below are not obvious from the code in `src/evidence/` and are not stated above.

- **`digests.ts`.** A changed file that cannot be read (deleted, or outside the tree) is hashed by
  its path string instead, the same fallback the audit events use, so a row always has a stable
  subject. An empty change collapses to the all-zero digest, which is also the genesis link.
- **`ledger.ts`.** A row's identity hash leaves out `ts`, `content_hash`, `detail` and `skip_kind`,
  so the same finding de-duplicates across re-runs. Readers skip malformed lines, so a write cut
  short by a crash never poisons the log. A bundle row's `recorded_at` is mapped to `ts` in memory
  only; the bytes on disk are never rewritten, so a receipt that sealed them still verifies.
- **`fan-in.ts` and `grading.ts`.** The late evidence gates (bundle completeness, visual evidence,
  rules loaded) have a separate mapper because their shape carries `skipped` and `inconclusive`,
  which the gate-result shape cannot. A gate written before `skip_kind` existed reads as not
  required. A gate that measured nothing keeps `passed: true` for the runner but is graded
  `skipped`, never a pass. A failed deterministic gate is still deterministic evidence: the
  strength says how the evidence was made, not whether it passed. A ratchet measure that could not
  be computed is graded `blocked`.
- **`compliance/citations.ts`.** A clause is cited only when every gate signal it lists passed in
  the change's rows; an inconclusive or blocked gate never cites. Signals of another type do not
  stop a gate-based citation but never produce one by themselves, because gates are the
  deterministic join key. One citation is written per clause, gate and framework, so one passing
  gate can cite several frameworks. The field is omitted when empty, so receipts stay
  byte-identical for projects with no compliance pack, and a pack load failure means no citations,
  never a broken receipt.
- **`receipt/dsse.ts`.** The hash chain is computed over the DSSE pre-authentication encoding, the
  exact bytes a real signature would cover, so adding Sigstore later changes only the signer. Keyless
  intent needs CI plus the explicit `PAQAD_SIGSTORE=1` opt-in, because reaching Fulcio and Rekor
  needs the network and cosign; the keyless branch is not implemented inline, so it falls back to
  the hash chain and records that mode. The one "signature" is keyed `paqad-hash-chain` so nobody
  mistakes it for an asymmetric signature. `verifyReceiptSeal` checks one receipt's own bytes
  without the chain link, which is all a bundle can prove since it keeps only its latest receipt.
- **`receipt/ai-bom.ts`.** The BOM is CycloneDX-shaped so existing tooling can read it, extended with
  `paqad:evidence:*` properties for the graded results CycloneDX has no place for; it does not claim
  to be a fully validated CycloneDX document. Its serial number is a UUID-shaped digest of the
  content (not a random or RFC-versioned UUID), so re-projecting the same evidence gives the same
  BOM. The authorship `provenance` grade is always emitted so a declared model is never read as a
  verified one.
- **`receipt/authorship.ts`.** `PAQAD_AGENT_MODEL` and `PAQAD_AGENT_PROVIDER` win over
  `PAQAD_MODEL_ID`, which fills any gap; when both are known `model_id` is rebuilt in the canonical
  form. When nothing resolves the field is left out. Resolution never throws.
- **`receipt/envelope.ts`.** Decoding the wrapped statement lives in this leaf file so the
  per-feature receipt readers can use it without importing `project.ts`, which imports them back.
  `project.ts` re-exports it so existing importers keep working.
- **`receipt/project.ts`.** Every write is atomic (temp file and rename), and the chain is appended
  before the latest snapshot is written. The statement is always built because the AI-BOM needs it,
  but the receipt and the AI-BOM are written under separate switches, and the envelope is returned
  even when nothing is written.
- **`receipt/statement.ts`.** A skipped row did not apply to the change, so it never moves the graded
  counts. When the bundle's `evidence.jsonl` is sealed the predicate carries its hash and line count
  instead of the rows, while the counts and verdict are still computed from the rows. Optional
  predicate fields (authorship, citations, reproducibility, shape metrics) are omitted when absent
  so older receipts stay byte-identical.
- **`reproducibility.ts`.** The context hash is computed during a session rebuild but the receipt is
  built later, so the stamp is stored here in between. It is written atomically and read tolerantly
  (a malformed file means no stamp). It records `determinism: 'input-replay'`: the frozen input and
  the recorded output identity, never a claim of bit-identical regeneration, because a hosted model
  exposes no stable seed.

## Boundaries

- **Owns:** the unified ledger, the merge-time receipt projected from it, and the
  change-authorship dimension folded into that receipt (#120).
- **Does not own:** making gates fire from hooks (issue #117, the binding layer
  this builds on); raw cross-vendor authorship logging (left to `agent-trace` /
  `git-ai`, which this interoperates with); gate→legal-clause mapping; the
  context-replay stamp; SIEM export; third-party (Sigstore) signing.
- The gate and quality-ratchet fan-in is wired at the merge-time backstop.
  Traceability (`TR-*`), pentest (`PT-*`), and triage findings share the same
  schema via `findingRowsFrom` and are emitted by their own engines.
