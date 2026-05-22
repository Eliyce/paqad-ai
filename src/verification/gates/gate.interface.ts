import type {
  GateResult,
  VerificationContext,
  VerificationGate,
} from '@/core/types/verification.js';

export interface Gate {
  readonly gate: VerificationGate;
  check(context: VerificationContext): Promise<GateResult>;
}
