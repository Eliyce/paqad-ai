import type { GateResult, GateSkipKind, VerificationGate } from '@/core/types/verification.js';
import type { EvidenceStrengthClass, EvidenceVerdict } from '@/core/types/evidence-ledger.js';

export const GATE_STRENGTH_TIER: Record<VerificationGate, 'deterministic' | 'llm-judged'> = {
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
  'site-map-freshness': 'deterministic',
  'extension-surface': 'deterministic',
  duplication: 'deterministic',
  'requirement-completeness': 'llm-judged',
  'story-quality': 'llm-judged',
  'spec-review': 'llm-judged',
  'implementation-review': 'llm-judged',
};

export const LATE_GATE_STRENGTH_TIER: Readonly<Record<string, 'deterministic' | 'llm-judged'>> = {
  'fix-proof': 'deterministic',
};

export interface GradedGateResult {
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
  skip_kind?: GateSkipKind;
}

export function gradeGateResult(result: GateResult): GradedGateResult {
  if (result.outcome) {
    return { verdict: 'skipped', strength_class: 'deterministic', skip_kind: result.outcome };
  }
  if (result.inconclusive) {
    return { verdict: 'inconclusive', strength_class: 'blocked' };
  }
  return {
    verdict: result.passed ? 'pass' : 'fail',
    strength_class: GATE_STRENGTH_TIER[result.gate],
  };
}
