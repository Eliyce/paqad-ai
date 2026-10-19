import type {
  GateResult,
  VerificationContext,
  VerificationGate,
} from '@/core/types/verification.js';

export function checkBooleanGate(
  gate: VerificationGate,
  value: boolean,
  passDetail: string,
  failDetail: string,
  remediation: string,
): GateResult {
  return {
    gate,
    passed: value,
    detail: value ? passDetail : failDetail,
    remediation: value ? undefined : remediation,
  };
}

export function createPass(gate: VerificationGate, detail: string): GateResult {
  return { gate, passed: true, detail };
}

export function createFail(
  gate: VerificationGate,
  detail: string,
  remediation: string,
): GateResult {
  return { gate, passed: false, detail, remediation };
}

export function createInconclusive(
  gate: VerificationGate,
  detail: string,
  remediation: string,
): GateResult {
  return { gate, passed: false, inconclusive: true, detail, remediation };
}

/**
 * Issue #639, Part 10 — the change gave this gate nothing to check. `passed` stays true so the
 * runner never treats it as the first failure and no verdict kind changes; the evidence records
 * it as skipped and not required, never as a pass. `detail` says what had nothing to check.
 */
export function createNotRequired(gate: VerificationGate, detail: string): GateResult {
  return { gate, passed: true, outcome: 'not-required', detail };
}

/**
 * Issue #639, Part 10 — the gate was owed a check that did not happen (a tool not configured, a
 * red test command, every measure blocked). `passed` stays true for the same reason as
 * {@link createNotRequired}; the evidence records it as skipped and did not run, never a pass.
 */
export function createDidNotRun(
  gate: VerificationGate,
  detail: string,
  remediation?: string,
): GateResult {
  return {
    gate,
    passed: true,
    outcome: 'did-not-run',
    detail,
    ...(remediation !== undefined ? { remediation } : {}),
  };
}

export function identity<T extends keyof VerificationContext>(key: T) {
  return (context: VerificationContext) => context[key];
}
