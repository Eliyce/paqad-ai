import type {
  DeltaReasoningPayload,
  DriftDelta,
  DriftFileSnapshot,
  EvaluateEscalationInput,
  VerificationDelta,
  VerificationGateSnapshot,
} from '@/core/types/token-efficiency.js';
import type { GateResult } from '@/core/types/verification.js';
import {
  buildDriftDeltaReasoningPayload,
  buildVerificationDeltaReasoningPayload,
} from '@/token-efficiency/index.js';

export function toVerificationSnapshots(results: GateResult[]): VerificationGateSnapshot[] {
  return results.map((result) => ({
    gate: result.gate,
    passed: result.passed,
    detail: result.detail,
    remediation: result.remediation,
  }));
}

export function buildVerificationGateDeltaPayload(
  baselineResults: GateResult[],
  currentResults: GateResult[],
  escalationInput: Omit<EvaluateEscalationInput, 'compact'> = {},
): DeltaReasoningPayload<VerificationDelta> {
  return buildVerificationDeltaReasoningPayload(
    toVerificationSnapshots(baselineResults),
    toVerificationSnapshots(currentResults),
    escalationInput,
  );
}

export function buildDocumentationDriftDeltaPayload(
  baseline: DriftFileSnapshot[],
  current: DriftFileSnapshot[],
  escalationInput: Omit<EvaluateEscalationInput, 'compact'> = {},
): DeltaReasoningPayload<DriftDelta> {
  return buildDriftDeltaReasoningPayload(baseline, current, escalationInput);
}
