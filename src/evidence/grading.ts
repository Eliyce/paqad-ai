// Issue #118 — evidence-strength grading (the anti-"provenance-theater" core).
//
// Every gate is classified once, here, as Tier A (deterministic / self-computed)
// or Tier B (LLM-judged — consumes a pre-computed boolean via `checkBooleanGate`).
// An inconclusive result is Tier C (blocked) regardless of its gate, because no
// evidence was actually established. This single map is the source of truth the
// ledger and receipt grade across; flattening A and B is exactly the theater the
// receipt exists to prevent.

import type { GateResult, VerificationGate } from '@/core/types/verification.js';
import type { EvidenceStrengthClass, EvidenceVerdict } from '@/core/types/evidence-ledger.js';

/**
 * Tier A vs Tier B for every one of the 17 gates. Derived from reading
 * `src/verification/gates/`: Tier B gates consume a bare boolean verdict via
 * `checkBooleanGate` (the model/heuristic produced the pass/fail upstream);
 * every other gate computes its own verdict from artifacts.
 */
export const GATE_STRENGTH_TIER: Record<VerificationGate, 'deterministic' | 'llm-judged'> = {
  // Tier A — deterministic / self-computed.
  'change-completeness': 'deterministic',
  'ac-test-mapping': 'deterministic',
  'architecture-compliance': 'deterministic',
  'code-tests-lint': 'deterministic',
  'behavioral-correctness': 'deterministic',
  'mutation-testing': 'deterministic',
  'quality-ratchet': 'deterministic',
  'database-quality': 'deterministic',
  'module-docs-structure': 'deterministic',
  'instructions-docs-structure': 'deterministic',
  'documentation-freshness': 'deterministic',
  'extension-surface': 'deterministic',
  // Issue #358 — the duplication gate reads its own cached report (no LLM).
  duplication: 'deterministic',
  // Tier B — LLM-judged (consume a pre-computed boolean verdict).
  'requirement-completeness': 'llm-judged',
  'story-quality': 'llm-judged',
  'spec-review': 'llm-judged',
  'implementation-review': 'llm-judged',
};

export interface GradedGateResult {
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
}

/**
 * Grade one gate result. An inconclusive gate has no usable evidence, so it is
 * Tier C (`blocked`) regardless of which gate it is; otherwise the strength is
 * the gate's tier and the verdict follows `passed`. `strength_class` describes
 * *how* the evidence was established, independent of pass/fail — a failed
 * deterministic gate is still deterministic evidence.
 */
export function gradeGateResult(result: GateResult): GradedGateResult {
  if (result.inconclusive) {
    return { verdict: 'inconclusive', strength_class: 'blocked' };
  }
  return {
    verdict: result.passed ? 'pass' : 'fail',
    strength_class: GATE_STRENGTH_TIER[result.gate],
  };
}
