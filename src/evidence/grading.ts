import {
  GATE_CATALOG,
  LATE_GATES,
  VERIFICATION_GATES,
  gateCatalogEntry,
  type GateSkipKind,
  type GateStrength,
  type VerificationGate,
} from '@/core/types/verification.js';
import type { EvidenceStrengthClass, EvidenceVerdict } from '@/core/types/evidence-ledger.js';

export const GATE_STRENGTH_TIER: Record<VerificationGate, GateStrength> = Object.fromEntries(
  VERIFICATION_GATES.map((gate) => [gate, GATE_CATALOG[gate].strength]),
) as Record<VerificationGate, GateStrength>;

export const LATE_GATE_STRENGTH_TIER: Readonly<Record<string, GateStrength>> = Object.fromEntries(
  LATE_GATES.map((gate) => [gate, GATE_CATALOG[gate].strength]),
);

export type GateState = 'pass' | 'fail' | 'inconclusive' | 'did-not-run' | 'not-required';

export const GATE_STATE_LABEL: Readonly<Record<GateState, string>> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Could not prove',
  'did-not-run': 'Did not run',
  'not-required': 'Not required',
};

export interface GradableGate {
  gate: string;
  passed: boolean;
  inconclusive?: boolean;
  outcome?: GateSkipKind;
}

export interface GradedGateResult {
  verdict: EvidenceVerdict;
  strength_class: EvidenceStrengthClass;
  skip_kind?: GateSkipKind;
}

export function gateStateOf(result: GradableGate | null | undefined): GateState {
  if (!result) return 'did-not-run';
  if (result.outcome) return result.outcome;
  if (result.inconclusive) return 'inconclusive';
  return result.passed ? 'pass' : 'fail';
}

export function gradeGateResult(result: GradableGate): GradedGateResult {
  const state = gateStateOf(result);
  if (state === 'did-not-run' || state === 'not-required') {
    return { verdict: 'skipped', strength_class: 'deterministic', skip_kind: state };
  }
  if (state === 'inconclusive') {
    return { verdict: 'inconclusive', strength_class: 'blocked' };
  }
  return {
    verdict: state,
    strength_class: gateCatalogEntry(result.gate)?.strength ?? 'deterministic',
  };
}
