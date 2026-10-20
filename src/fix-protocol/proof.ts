import type {
  ProofCheck,
  ProofGenuinenessVerdict,
  ProofRunResult,
} from '@/core/types/fix-protocol.js';

export function assessProofGenuineness(
  proof: ProofCheck,
  unfixedRun: ProofRunResult,
): ProofGenuinenessVerdict {
  if (unfixedRun.passed) {
    return {
      genuine: false,
      reason: `Proof "${proof.test_id}" passed on the unfixed tree; it does not reproduce the defect.`,
    };
  }

  const signal = proof.expected_failure_signal;
  if (signal !== undefined && signal.length > 0 && !unfixedRun.output.includes(signal)) {
    return {
      genuine: false,
      reason: `Proof "${proof.test_id}" failed, but not for the reported defect (signal "${signal}" absent).`,
    };
  }

  return {
    genuine: true,
    reason: `Proof "${proof.test_id}" fails on the unfixed tree, reproducing the defect.`,
  };
}

export function proofPassesAfterFix(
  proof: ProofCheck,
  fixedRun: ProofRunResult,
): { passes: boolean; reason: string } {
  if (fixedRun.passed) {
    return {
      passes: true,
      reason: `Proof "${proof.test_id}" now passes after the fix.`,
    };
  }
  return {
    passes: false,
    reason: `Proof "${proof.test_id}" still fails after the fix; the defect is not resolved.`,
  };
}
