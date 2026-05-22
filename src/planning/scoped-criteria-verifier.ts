import type { SliceCriteriaCheck, VerificationCriterion } from '@/core/types/planning.js';

export interface CriteriaTestRunResult {
  passed: boolean;
  detail?: string;
}

export type CriteriaTestRunner = (
  proofTarget: string,
  criterion: VerificationCriterion,
) => Promise<CriteriaTestRunResult>;

export async function verifyScopedCriteria(
  criteria: VerificationCriterion[],
  runTest: CriteriaTestRunner,
): Promise<SliceCriteriaCheck[]> {
  const results: SliceCriteriaCheck[] = [];

  for (const criterion of criteria) {
    if (criterion.proof_type !== 'automated' || !criterion.proof_target) {
      results.push({
        criterion_id: criterion.criterion_id,
        status: criterion.status,
        passed: criterion.status === 'covered',
        detail: 'No automated proof target for slice criterion.',
      });
      continue;
    }

    const outcome = await runTest(criterion.proof_target, criterion);
    results.push({
      criterion_id: criterion.criterion_id,
      status: outcome.passed ? 'covered' : criterion.status,
      proof_target: criterion.proof_target,
      passed: outcome.passed,
      detail: outcome.detail ?? (outcome.passed ? 'criterion passed' : 'criterion failed'),
    });
  }

  return results;
}
