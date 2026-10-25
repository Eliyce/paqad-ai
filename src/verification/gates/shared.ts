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

export function checkJudgedGate(
  gate: VerificationGate,
  value: boolean | undefined,
  passDetail: string,
  failDetail: string,
  remediation: string,
  absentDetail: string,
): GateResult {
  return value === undefined
    ? createDidNotRun(gate, absentDetail)
    : checkBooleanGate(gate, value, passDetail, failDetail, remediation);
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

export function createNotRequired(gate: VerificationGate, detail: string): GateResult {
  return { gate, passed: true, outcome: 'not-required', detail };
}

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
