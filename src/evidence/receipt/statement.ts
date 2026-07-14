// Issue #118 — project an in-toto Statement (v1) with a SLSA-VSA-modelled
// predicate from a window of graded ledger rows.
//
// The predicate's `graded_results` is the anti-theater payload: deterministic
// passes and LLM-judged passes are counted separately and never summed into one
// "N/16 passed" figure, and blocked/inconclusive rows are surfaced as their own
// counts rather than hidden inside a pass total.

import {
  IN_TOTO_STATEMENT_TYPE,
  PAQAD_VSA_PREDICATE_TYPE,
  EVIDENCE_LEDGER_SCHEMA_VERSION,
  type ChangeAuthorship,
  type ComplianceCitation,
  type EvidenceEngine,
  type EvidenceFileDigest,
  type EvidenceLedgerRow,
  type GradedEvidenceSummary,
  type InTotoStatement,
  type InTotoSubject,
  type ReproducibilityStampPredicate,
  type VsaPredicate,
} from '@/core/types/evidence-ledger.js';

/** Tally rows into the graded summary. Passes are split by strength class so a
 *  computed pass is never pooled with a model's say-so. */
export function summarizeGradedEvidence(rows: readonly EvidenceLedgerRow[]): GradedEvidenceSummary {
  const summary: GradedEvidenceSummary = {
    deterministic: { pass: 0, fail: 0 },
    llm_judged: { pass: 0, fail: 0 },
    blocked: 0,
    inconclusive: 0,
  };
  for (const row of rows) {
    if (row.verdict === 'inconclusive') {
      summary.inconclusive += 1;
      continue;
    }
    if (row.verdict === 'blocked' || row.strength_class === 'blocked') {
      summary.blocked += 1;
      continue;
    }
    const bucket = row.strength_class === 'llm-judged' ? summary.llm_judged : summary.deterministic;
    if (row.verdict === 'pass') bucket.pass += 1;
    else if (row.verdict === 'fail') bucket.fail += 1;
  }
  return summary;
}

function countByEngine(
  rows: readonly EvidenceLedgerRow[],
): Partial<Record<EvidenceEngine, number>> {
  const counts: Partial<Record<EvidenceEngine, number>> = {};
  for (const row of rows) {
    counts[row.engine] = (counts[row.engine] ?? 0) + 1;
  }
  return counts;
}

/**
 * The three-way verification outcome (issue #368, AC-D2).
 *
 * A `blocked` row is a measure that COULD NOT RUN (an unwired or absent tool, e.g. a
 * quality-ratchet measure reporting "tool-not-wired"); an `inconclusive` row could not
 * be judged. Neither is a failure — conflating "couldn't verify" with "verification
 * failed" manufactured a false `FAILED` (a change with 9/9 + 2/2 real passes and only
 * three unwired ratchet measures still read `FAILED`). So:
 *   - a genuine `fail` (deterministic or llm-judged) → `FAILED`;
 *   - otherwise, any `blocked`/`inconclusive` row → `INCONCLUSIVE` (do not over-trust,
 *     but do not cry failure either);
 *   - everything passed → `PASSED`.
 * A real failure always dominates a couldn't-verify, so a mix of fail + blocked is still
 * `FAILED`.
 */
export function deriveVerificationResult(
  summary: GradedEvidenceSummary,
): 'PASSED' | 'FAILED' | 'INCONCLUSIVE' {
  if (summary.deterministic.fail > 0 || summary.llm_judged.fail > 0) {
    return 'FAILED';
  }
  if (summary.blocked > 0 || summary.inconclusive > 0) {
    return 'INCONCLUSIVE';
  }
  return 'PASSED';
}

export interface BuildStatementInput {
  fileDigests: readonly EvidenceFileDigest[];
  rows: readonly EvidenceLedgerRow[];
  verifierVersion: string;
  timeVerified: string;
  /** Issue #120 — who wrote/accepted the change. Omitted from the predicate
   *  when absent, so receipts without authorship stay byte-identical. */
  authorship?: ChangeAuthorship;
  /** Issue #122 — `gate → clause` citations. Omitted when empty/absent. */
  complianceCitations?: readonly ComplianceCitation[];
  /** Issue #123 — frozen-context reproducibility stamp. Omitted when absent. */
  reproducibility?: ReproducibilityStampPredicate;
}

/** Build the in-toto Statement: per-file subjects + a graded VSA predicate. */
export function buildInTotoStatement(input: BuildStatementInput): InTotoStatement {
  const subject: InTotoSubject[] = input.fileDigests.map((digest) => ({
    name: digest.name,
    digest: { sha256: digest.sha256 },
  }));

  const summary = summarizeGradedEvidence(input.rows);

  const predicate: VsaPredicate = {
    verifier: { id: 'https://paqad.ai', version: input.verifierVersion },
    time_verified: input.timeVerified,
    policy: {
      predicate_type: PAQAD_VSA_PREDICATE_TYPE,
      schema_version: EVIDENCE_LEDGER_SCHEMA_VERSION,
    },
    verification_result: deriveVerificationResult(summary),
    graded_results: summary,
    evidence_by_engine: countByEngine(input.rows),
    ...(input.authorship !== undefined ? { change_authorship: input.authorship } : {}),
    ...(input.complianceCitations !== undefined && input.complianceCitations.length > 0
      ? { compliance_citations: [...input.complianceCitations] }
      : {}),
    ...(input.reproducibility !== undefined ? { reproducibility: input.reproducibility } : {}),
    rows: [...input.rows],
  };

  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject,
    predicateType: PAQAD_VSA_PREDICATE_TYPE,
    predicate,
  };
}
