import {
  IN_TOTO_STATEMENT_TYPE,
  PAQAD_VSA_PREDICATE_TYPE,
  EVIDENCE_LEDGER_SCHEMA_VERSION,
  type ChangeAuthorship,
  type ComplianceCitation,
  type EvidenceEngine,
  type EvidenceFileDigest,
  type EvidenceLedgerRow,
  type EvidenceSeal,
  type GradedEvidenceSummary,
  type InTotoStatement,
  type InTotoSubject,
  type MetricsPredicate,
  type ReproducibilityStampPredicate,
  type VsaPredicate,
} from '@/core/types/evidence-ledger.js';

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
    if (row.verdict === 'skipped') continue;
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

export function deriveVerificationResult(
  summary: GradedEvidenceSummary,
): 'PASSED' | 'FAILED' | 'INCONCLUSIVE' {
  if (summary.deterministic.fail > 0 || summary.llm_judged.fail > 0) {
    return 'FAILED';
  }
  if (summary.inconclusive > 0) {
    return 'INCONCLUSIVE';
  }
  return 'PASSED';
}

export interface BuildStatementInput {
  fileDigests: readonly EvidenceFileDigest[];
  rows: readonly EvidenceLedgerRow[];
  verifierVersion: string;
  timeVerified: string;
  authorship?: ChangeAuthorship;
  complianceCitations?: readonly ComplianceCitation[];
  reproducibility?: ReproducibilityStampPredicate;
  metrics?: MetricsPredicate;
  evidenceSeal?: EvidenceSeal;
}

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
    ...(input.metrics !== undefined ? { metrics: input.metrics } : {}),
    ...(input.evidenceSeal !== undefined
      ? {
          evidence_sha256: input.evidenceSeal.sha256,
          evidence_line_count: input.evidenceSeal.line_count,
        }
      : { rows: [...input.rows] }),
  };

  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject,
    predicateType: PAQAD_VSA_PREDICATE_TYPE,
    predicate,
  };
}
