// Issue #118 — fan-in: every engine's output, mapped to unified ledger rows.
//
// The gate runner is the merge-time fan-in point: after `run()` returns
// `GateResult[]`, one row per gate is emitted. The quality-ratchet's per-measure
// verdicts add finer-grained rows (a blocked measure is graded Tier C even when
// the gate as a whole passed). Content-addressed findings from the other engines
// (traceability `TR-*`, pentest `PT-*`, triage verdicts) share the same schema
// via {@link findingRowsFrom}.

import type { GateResult } from '@/core/types/verification.js';
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

/** One ledger row per gate result (Tier A/B verdict + strength). */
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
    });
  });
}

/** Map one ratchet measure outcome to a graded verdict. A measure that could
 *  not be computed is Tier C (`blocked`); everything else is deterministic. */
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

/**
 * One row per evaluated ratchet measure. This is where the receipt's honest
 * "1 ratchet measure blocked (no tsconfig)" line comes from — the gate-level
 * `quality-ratchet` row says pass/fail, these say *which* measures were real
 * evidence and which were blocked.
 */
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

/** A content-addressed finding from a correctness engine: a stable id, a
 *  pass/fail/blocked verdict, and how strongly it was established. */
export interface EngineFinding {
  /** Content-addressed code/id (e.g. `TR-UNTESTED-PROMISE`, `PT-<fingerprint>`). */
  code: string;
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
  detail?: string;
}

/**
 * Map any engine's content-addressed findings into ledger rows. Traceability and
 * pentest findings are deterministic (content-addressed IDs); triage verdicts are
 * a judgment and should be passed as `llm-judged`. The caller owns the verdict +
 * strength so this stays a pure shape adapter.
 */
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
