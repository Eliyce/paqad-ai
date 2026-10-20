import type { GateResult } from '@/core/types/verification.js';
import type {
  EvidenceGateStatus,
  VerificationEvidenceGate,
} from '@/core/types/verification-evidence.js';
import type { QualityRatchetResult, RatchetMeasureVerdict } from '@/core/types/quality-ratchet.js';
import type {
  EvidenceEngine,
  EvidenceLedgerRow,
  EvidenceStrengthClass,
  EvidenceVerdict,
} from '@/core/types/evidence-ledger.js';

import { gradeGateResult } from './grading.js';
import { buildEvidenceRow } from './ledger.js';

export interface RowContext {
  subjectDigest: string;
  ts: string;
}

export function gateResultsToRows(
  results: readonly GateResult[],
  ctx: RowContext,
): EvidenceLedgerRow[] {
  return results.map((result) => {
    const graded = gradeGateResult(result);
    return buildEvidenceRow({
      ts: ctx.ts,
      engine: 'verification-gate',
      code: result.gate,
      subject_digest: ctx.subjectDigest,
      verdict: graded.verdict,
      strength_class: graded.strength_class,
      detail: result.detail,
      ...(graded.skip_kind ? { skip_kind: graded.skip_kind } : {}),
    });
  });
}

const EVIDENCE_GATE_GRADES: Record<
  EvidenceGateStatus,
  { verdict: EvidenceVerdict; strength_class: EvidenceStrengthClass }
> = {
  pass: { verdict: 'pass', strength_class: 'deterministic' },
  fail: { verdict: 'fail', strength_class: 'deterministic' },
  inconclusive: { verdict: 'inconclusive', strength_class: 'blocked' },
  skipped: { verdict: 'skipped', strength_class: 'deterministic' },
};

export function evidenceGatesToRows(
  gates: readonly VerificationEvidenceGate[],
  ctx: RowContext,
): EvidenceLedgerRow[] {
  return gates.map((gate) =>
    buildEvidenceRow({
      ts: ctx.ts,
      engine: 'verification-gate',
      code: gate.name,
      subject_digest: ctx.subjectDigest,
      ...EVIDENCE_GATE_GRADES[gate.status],
      detail: gate.detail,
      ...(gate.status === 'skipped' && gate.skip_kind ? { skip_kind: gate.skip_kind } : {}),
    }),
  );
}

function gradeRatchetVerdict(verdict: RatchetMeasureVerdict): {
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
} {
  if (verdict.outcome === 'blocked') {
    return { verdict: 'blocked', strength_class: 'blocked' };
  }
  return {
    verdict: verdict.outcome === 'regressed' ? 'fail' : 'pass',
    strength_class: 'deterministic',
  };
}

export function ratchetResultToRows(
  result: QualityRatchetResult | undefined,
  ctx: RowContext,
): EvidenceLedgerRow[] {
  if (!result) return [];
  return result.verdicts.map((verdict) => {
    const graded = gradeRatchetVerdict(verdict);
    return buildEvidenceRow({
      ts: ctx.ts,
      engine: 'quality-ratchet',
      code: `ratchet:${verdict.measure}:${verdict.module}`,
      subject_digest: ctx.subjectDigest,
      verdict: graded.verdict,
      strength_class: graded.strength_class,
      detail: verdict.detail,
    });
  });
}

export interface EngineFinding {
  code: string;
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
  detail?: string;
}

export function findingRowsFrom(
  engine: EvidenceEngine,
  findings: readonly EngineFinding[],
  ctx: RowContext,
): EvidenceLedgerRow[] {
  return findings.map((finding) =>
    buildEvidenceRow({
      ts: ctx.ts,
      engine,
      code: finding.code,
      subject_digest: ctx.subjectDigest,
      verdict: finding.verdict,
      strength_class: finding.strength_class,
      ...(finding.detail !== undefined ? { detail: finding.detail } : {}),
    }),
  );
}
