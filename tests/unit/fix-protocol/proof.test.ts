import { describe, expect, it } from 'vitest';

import { assessProofGenuineness, proofPassesAfterFix } from '@/fix-protocol/proof.js';
import type { ProofCheck } from '@/core/types/fix-protocol.js';

const PROOF: ProofCheck = {
  test_file: 'tests/unit/x.test.ts',
  test_id: 'x > does the thing',
  command: 'pnpm vitest run tests/unit/x.test.ts',
};

describe('assessProofGenuineness', () => {
  it('rejects a proof that passes on the unfixed tree', () => {
    const verdict = assessProofGenuineness(PROOF, { passed: true, output: 'all good' });
    expect(verdict.genuine).toBe(false);
    expect(verdict.reason).toContain('does not reproduce');
  });

  it('accepts a proof that fails on the unfixed tree when no signal is required', () => {
    const verdict = assessProofGenuineness(PROOF, { passed: false, output: 'AssertionError' });
    expect(verdict.genuine).toBe(true);
    expect(verdict.reason).toContain('reproducing the defect');
  });

  it('accepts a proof that fails with the expected failure signal present', () => {
    const proof: ProofCheck = { ...PROOF, expected_failure_signal: 'NaN' };
    const verdict = assessProofGenuineness(proof, {
      passed: false,
      output: 'Expected 2 but got NaN',
    });
    expect(verdict.genuine).toBe(true);
  });

  it('rejects a proof that fails but not for the reported reason (signal absent)', () => {
    const proof: ProofCheck = { ...PROOF, expected_failure_signal: 'NaN' };
    const verdict = assessProofGenuineness(proof, {
      passed: false,
      output: 'TypeError: cannot read property of undefined',
    });
    expect(verdict.genuine).toBe(false);
    expect(verdict.reason).toContain('not for the reported defect');
  });

  it('ignores an empty signal string and accepts a genuine failure', () => {
    const proof: ProofCheck = { ...PROOF, expected_failure_signal: '' };
    const verdict = assessProofGenuineness(proof, { passed: false, output: 'boom' });
    expect(verdict.genuine).toBe(true);
  });
});

describe('proofPassesAfterFix', () => {
  it('confirms the once-failing proof now passes', () => {
    const result = proofPassesAfterFix(PROOF, { passed: true, output: 'ok' });
    expect(result.passes).toBe(true);
    expect(result.reason).toContain('now passes');
  });

  it('reports the proof still failing after the fix', () => {
    const result = proofPassesAfterFix(PROOF, { passed: false, output: 'still broken' });
    expect(result.passes).toBe(false);
    expect(result.reason).toContain('still fails');
  });
});
