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
  type EvidenceEngine,
  type EvidenceFileDigest,
  type EvidenceLedgerRow,
  type GradedEvidenceSummary,
  type InTotoStatement,
  type InTotoSubject,
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

/** A change PASSES only when nothing failed and no evidence was missing —
 *  blocked or inconclusive rows downgrade the result, never silently pass. */
export function deriveVerificationResult(summary: GradedEvidenceSummary): 'PASSED' | 'FAILED' {
  const failed =
    summary.deterministic.fail > 0 ||
    summary.llm_judged.fail > 0 ||
    summary.blocked > 0 ||
    summary.inconclusive > 0;
  return failed ? 'FAILED' : 'PASSED';
}

export interface BuildStatementInput {
  fileDigests: readonly EvidenceFileDigest[];
  rows: readonly EvidenceLedgerRow[];
  verifierVersion: string;
  timeVerified: string;
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
    rows: [...input.rows],
  };

  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject,
    predicateType: PAQAD_VSA_PREDICATE_TYPE,
    predicate,
  };
}
