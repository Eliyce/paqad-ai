// Issue #107 — act only on confirmed problems, not on noise. As paqad works it
// produces a stream of "things that look like problems" (gate failures,
// gap-detector / adversarial-reviewer output, spec-review defects). That stream
// is a mixture — real defects, matters of taste, plain misreads, and signs the
// *spec* was unclear. Before acting on any finding it is sorted into exactly one
// of four piles; only the confirmed pile may drive a code change.
//
// Boundaries (do not rebuild here):
// - *Proving* a confirmed problem and fixing it → issue #103 (the `confirmed`
//   pile hands off to its prove-it protocol).
// - The spec content the `unclear-spec` pile lands in → issue #102.
// - Measurable quality regressions masquerading as taste → issue #110 (such a
//   finding is routed to the ratchet, never binned as `taste`).
// - Settle-once / never-re-raise memory is the shipped Decision Pause Contract —
//   reused by kind, never a second memory.

/** The four piles every finding is sorted into before any responsive change. */
export const TRIAGE_PILES = ['confirmed', 'unclear-spec', 'false-alarm', 'taste'] as const;
export type TriagePile = (typeof TRIAGE_PILES)[number];

/** Where a finding originates — the streams that get triaged. */
export const TRIAGE_FINDING_SOURCES = [
  'gate',
  'gap-detector',
  'adversarial-reviewer',
  'final-reviewer',
  'spec-review',
] as const;
export type TriageFindingSource = (typeof TRIAGE_FINDING_SOURCES)[number];

/**
 * What happens to a finding next.
 * - `code-change`  — confirmed *and* demonstrable: may drive an edit (→ #103 proof).
 * - `await-repro`  — confirmed but not yet reproducible: waits, must NOT drive an edit.
 * - `spec`         — unclear-spec: routed back to the spec (#102), not patched.
 * - `record`       — false-alarm / taste: set aside with a reason, no edit.
 * - `ratchet`      — measurable quality regression: handed to the ratchet (#110).
 * - `ask-human`    — genuinely ambiguous: opens a `finding.triage` Decision Pause.
 */
export const TRIAGE_ROUTES = [
  'code-change',
  'await-repro',
  'spec',
  'record',
  'ratchet',
  'ask-human',
] as const;
export type TriageRoute = (typeof TRIAGE_ROUTES)[number];

/** The sub-state of the `confirmed` pile. "Confirmed" must mean *demonstrable*. */
export const TRIAGE_CONFIRMATIONS = ['demonstrable', 'needs-repro'] as const;
export type TriageConfirmation = (typeof TRIAGE_CONFIRMATIONS)[number];

/**
 * The deterministic signals a finding carries. The rules-first classifier reads
 * these to sort the clear cases; only when none of them resolve a pile is the
 * finding ambiguous and (off the `fast` lane) put to the human. Per the research
 * (issue #107), the classifier never asks the model to over-explain — it sorts
 * on evidence, not narrative.
 */
export interface TriageSignals {
  /** A gate (lint/test/typecheck/mutation) actually failed. */
  gate_failed?: boolean;
  /** A reproducing proof exists (issue #103) — required to reach `demonstrable`. */
  reproducible?: boolean;
  /** The finding affects runtime behaviour (vs. pure style/preference). */
  behavioural?: boolean;
  /** The finding is really "the spec didn't say" — belongs to the spec (#102). */
  spec_silent?: boolean;
  /** Style/format only, no behavioural effect — a matter of taste. */
  style_only?: boolean;
  /** A measurable strictness/complexity regression — belongs to the ratchet (#110). */
  measurable_quality?: boolean;
  /** Contradicted by evidence (e.g. cited location does not exist) — a misread. */
  refuted_by_evidence?: boolean;
}

/** A normalized finding entering triage, from any of the sources above. */
export interface TriageFinding {
  /** Stable id of the finding within a run. */
  id: string;
  source: TriageFindingSource;
  /**
   * The *kind* of finding (e.g. `style-only-lint`, `spec-gap`, `naming-pref`).
   * Used as the Decision Pause fingerprint key so two same-kind ambiguous
   * findings reuse one saved verdict — the system gets quieter over time.
   */
  kind: string;
  message: string;
  file?: string | null;
  line?: number | null;
  signals: TriageSignals;
}

/** The triage verdict for a single finding. */
export interface TriageVerdict {
  finding_id: string;
  /** One of the four piles, or `null` when the finding is ambiguous / off-piles (ratchet). */
  pile: TriagePile | null;
  /** True only when the rules could not sort it and a human (or LLM) must. */
  ambiguous: boolean;
  /** Present only when `pile === 'confirmed'`. */
  confirmation?: TriageConfirmation;
  route: TriageRoute;
  reason: string;
}

/** Schema version for the persisted per-run triage ledger. */
export const TRIAGE_LEDGER_SCHEMA_VERSION = '1.0.0' as const;

/** One recorded triage decision, kept for audit and reuse. */
export interface TriageLedgerEntry {
  finding_id: string;
  source: TriageFindingSource;
  kind: string;
  pile: TriagePile | null;
  route: TriageRoute;
  confirmation?: TriageConfirmation;
  reason: string;
  file?: string | null;
  line?: number | null;
  recorded_at: string;
}

/**
 * The per-run triage ledger. Records each finding's pile + reason so false
 * alarms and taste calls are auditable and reusable, and "confirmed → change"
 * is traceable.
 */
export interface TriageLedger {
  schema_version: typeof TRIAGE_LEDGER_SCHEMA_VERSION;
  updated_at: string;
  entries: TriageLedgerEntry[];
}
