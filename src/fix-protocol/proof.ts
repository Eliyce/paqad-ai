import type {
  ProofCheck,
  ProofGenuinenessVerdict,
  ProofRunResult,
} from '@/core/types/fix-protocol.js';

/**
 * Decides whether a proof genuinely reproduces the reported defect by examining
 * its result on the **unfixed** tree. A genuine proof must fail there, and —
 * when an `expected_failure_signal` is declared — fail *for the reported
 * reason* (the signal must appear in the output). A proof that passes on the
 * unfixed tree, or fails for an unrelated reason, is rejected: it would let a
 * trivially-passing or side-stepping check masquerade as a real reproduction
 * (issue #103 Settled decision).
 */
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

/**
 * After the fix, the once-failing proof must now pass. Returns whether step 3
 * ("prove fixed") is satisfied.
 */
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
