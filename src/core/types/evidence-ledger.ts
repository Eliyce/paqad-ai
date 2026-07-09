// Issue #118 — the unified, append-only evidence ledger and the merge-time
// provenance receipt projected from it.
//
// paqad already runs 16 verification gates plus standalone correctness engines,
// and three of them write isolated append-only JSONL audit trails — but the
// proof is discarded at merge. This module gives every engine one ledger to
// write to, and a per-change receipt to project from it.
//
// The load-bearing design rule (the anti-"provenance-theater" requirement):
// the ledger grades *how* each piece of evidence was established —
// deterministic / computed (Tier A), LLM-judged (Tier B), or blocked /
// inconclusive (Tier C) — so a receipt can never flatten a mutation-tested pass
// and a model's say-so into the same "12/16 gates passed" number.

import type { AdapterType } from './adapter.js';
import type { ComplianceEvidenceStrength, ComplianceRelation } from './pack.js';

/** Bumped when the on-disk ledger-row or receipt shape changes incompatibly. */
export const EVIDENCE_LEDGER_SCHEMA_VERSION = 1 as const;

/** Which engine produced a ledger row. */
export type EvidenceEngine =
  'verification-gate' | 'quality-ratchet' | 'traceability' | 'pentest' | 'triage';

/**
 * The outcome a row records. `blocked` is distinct from `inconclusive`: blocked
 * means the evidence could not be produced (no tool wired, missing config),
 * inconclusive means a check ran but could not reach a confident verdict.
 */
export type EvidenceVerdict = 'pass' | 'fail' | 'inconclusive' | 'blocked';

/**
 * How strongly the evidence was established — the anti-theater grade.
 *
 * - `deterministic` (Tier A): a computed, reproducible measure
 *   (mutation, ratchet, traceability, ac-test-mapping, lint/tests, …).
 * - `llm-judged` (Tier B): a verdict produced by a model judgment
 *   (spec-review, implementation-review, story-quality, requirement-completeness).
 * - `blocked` (Tier C): no evidence — the measure was unavailable or inconclusive.
 */
export type EvidenceStrengthClass = 'deterministic' | 'llm-judged' | 'blocked';

/**
 * One row in `.paqad/ledger/evidence.jsonl`. Append-only; readers tolerate
 * malformed lines so a mid-crash write can't poison the stream.
 *
 * `content_hash` is a SHA-256 over the *identity* fields (engine, code,
 * subject_digest, verdict, strength_class) and deliberately excludes `ts`, so
 * the same finding on the same subject de-duplicates across re-runs (de-dup is
 * a consumer responsibility — the writer only stamps the hash).
 */
export interface EvidenceLedgerRow {
  schema_version: typeof EVIDENCE_LEDGER_SCHEMA_VERSION;
  /** ISO-8601 emission time. Not part of `content_hash`. */
  ts: string;
  engine: EvidenceEngine;
  /** Gate name or finding code (e.g. `mutation-testing`, `TR-UNTESTED-PROMISE`). */
  code: string;
  /** SHA-256 identifying the change subject these rows pertain to (see below). */
  subject_digest: string;
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
  /** SHA-256 hex over the identity fields, for consumer-side de-duplication. */
  content_hash: string;
  /** Human-readable detail, carried for the receipt/reviewers. Not hashed. */
  detail?: string;
}

/** A single changed file and the SHA-256 of its bytes — an in-toto subject. */
export interface EvidenceFileDigest {
  /** Project-relative path. */
  name: string;
  /** SHA-256 hex of the file bytes (or of the path string when unreadable). */
  sha256: string;
}

// --- Receipt (in-toto Statement v1 + SLSA-VSA-modelled predicate) -----------

/** Pinned predicate type — a paqad URI modelled on the SLSA Verification
 *  Summary Attestation. Pinned so consumers can match on an exact version. */
export const PAQAD_VSA_PREDICATE_TYPE =
  'https://paqad.ai/attestations/verification-summary/v1' as const;

export const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1' as const;

/** Counts of rows by strength class and verdict — the graded summary that keeps
 *  the receipt honest (deterministic passes are never pooled with LLM-judged). */
export interface GradedEvidenceSummary {
  deterministic: { pass: number; fail: number };
  llm_judged: { pass: number; fail: number };
  blocked: number;
  inconclusive: number;
}

/**
 * Issue #120 — the change-authorship dimension that makes paqad a *neutral,
 * producer-agnostic* attestor: who wrote the change and who accepted it, folded
 * into the same gate-derived receipt so the attestation is **gate-derived, not
 * agent-derived**. paqad can vouch for a change regardless of which of its
 * supported adapters produced it; no single-vendor tool can occupy that seat.
 *
 * The provenance is honestly graded. `agent` is a known fact (the onboarded
 * adapter), but `model`/`provider` are *declared* — an adapter knows it is
 * "cursor" yet Cursor routes to many models — so they are recorded with no false
 * certainty and `provenance: 'declared'` says so. Field names mirror the
 * cross-vendor `agent-trace` convention (`model_id` = `provider/model`) so the
 * record interoperates with that ecosystem rather than competing with it.
 */
export interface ChangeAuthorship {
  /** Which paqad adapter produced the change (a known fact from onboarding). */
  agent?: AdapterType;
  /** Declared model, e.g. `claude-opus-4-8`. Not self-verified — see provenance. */
  model?: string;
  /** Declared provider, e.g. `anthropic`. Not self-verified — see provenance. */
  provider?: string;
  /** agent-trace–style `provider/model` identifier, when both are known. */
  model_id?: string;
  /** Git identity of the human who accepted the change (EU AI Act Art. 14). */
  accepting_human?: { name?: string; email?: string };
  /** How model/provider were established. `declared` = adapter/env said so,
   *  not independently verified; `unknown` = not supplied. */
  provenance: 'declared' | 'unknown';
}

/**
 * Issue #122 — one `gate → legal clause` citation derived from an active
 * compliance pack. Emitted only for a gate that *passed* (never inconclusive /
 * blocked), so the receipt can say which clause each green gate produces
 * evidence toward. The verbatim `disclaimer` rides along on every citation: this
 * is evidence *toward* a clause, never a conformity assessment.
 */
export interface ComplianceCitation {
  framework_id: string;
  framework_title: string;
  framework_version?: string;
  clause_id: string;
  clause_title: string;
  clause_url?: string;
  /** The passing gate that produced the evidence. */
  gate: string;
  /** OSCAL relation between the gate and the clause (honestly graded). */
  relation: ComplianceRelation;
  /** `partial` | `substantial` — never `full`. */
  evidence_strength: ComplianceEvidenceStrength;
  disclaimer: string;
}

/**
 * Issue #123 — the reproducibility stamp: a content hash over the exact frozen
 * context an agent saw, asserting the *input is replayable*. For a hosted LLM
 * (no stable seed; temp 0 is still non-deterministic) this proves replayable
 * input + recorded output, NOT bit-identical regeneration — so `determinism` is
 * fixed to `input-replay` and the field must never imply exact regeneration.
 */
export interface ReproducibilityStampPredicate {
  /** SHA-256 over the canonical, versioned rebuild materials. */
  context_hash: string;
  /** The only honest claim for a hosted LLM. */
  determinism: 'input-replay';
  /** Bumped when the preimage serialization changes, so a hash can be re-derived. */
  algo_version: number;
  /** True when the materials are faithfully reconstructable (input-replay holds). */
  replayable: boolean;
}

export interface VsaPredicate {
  verifier: { id: string; version: string };
  /** ISO-8601 time the verification completed. */
  time_verified: string;
  policy: { predicate_type: typeof PAQAD_VSA_PREDICATE_TYPE; schema_version: number };
  /** `PASSED` iff no row is `fail` and none are `blocked`/`inconclusive`. */
  verification_result: 'PASSED' | 'FAILED';
  /** The anti-theater grade: passes split by how they were established. */
  graded_results: GradedEvidenceSummary;
  /** Per-engine row counts, for at-a-glance provenance. */
  evidence_by_engine: Partial<Record<EvidenceEngine, number>>;
  /** Issue #120 — who wrote and accepted the change. Omitted entirely when no
   *  authorship could be resolved, so prior receipts stay byte-identical. */
  change_authorship?: ChangeAuthorship;
  /** Issue #122 — which legal clauses each passing gate produces evidence
   *  toward, from the active compliance packs. Omitted when no pack is installed
   *  (or no passing gate maps to a clause), so prior receipts stay byte-identical. */
  compliance_citations?: ComplianceCitation[];
  /** Issue #123 — the frozen-context reproducibility stamp. Omitted when no
   *  context stamp was recorded for the change, so receipts stay byte-identical. */
  reproducibility?: ReproducibilityStampPredicate;
  /** The graded rows themselves, so the receipt is self-contained. */
  rows: EvidenceLedgerRow[];
}

export interface InTotoSubject {
  name: string;
  digest: { sha256: string };
}

export interface InTotoStatement {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: InTotoSubject[];
  predicateType: typeof PAQAD_VSA_PREDICATE_TYPE;
  predicate: VsaPredicate;
}

/** How the receipt was signed. paqad is local-first, so "signed" honestly
 *  degrades to a tamper-evident hash chain when no CI/OIDC identity exists. */
export type ReceiptSigningMode = 'sigstore-keyless' | 'hash-chained';

export interface DsseSignature {
  keyid: string;
  sig: string;
}

/**
 * A DSSE (Dead Simple Signing Envelope) wrapping the in-toto Statement, plus a
 * paqad hash-chain extension that links each receipt to the previous one so the
 * ledger is tamper-evident even with no third-party anchor.
 */
export interface ReceiptEnvelope {
  payloadType: string;
  /** base64 of the canonical Statement JSON. */
  payload: string;
  signatures: DsseSignature[];
  /** paqad extension — not part of the DSSE spec. */
  paqad: {
    signing_mode: ReceiptSigningMode;
    /** SHA-256 of the previous receipt's PAE, or 64 zeros at genesis. */
    prev_receipt_hash: string;
    /** SHA-256 of this receipt's PAE — the chain link the next receipt embeds. */
    receipt_hash: string;
  };
}
