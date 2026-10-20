import type { FlakyRegistry, StabilityJudgement } from '@/core/types/flaky.js';

import { markCleared } from './registry.js';

export interface ClearQuarantineInput {
  registry: FlakyRegistry;
  test_id: string;
  suite: string | null;
  judgement: StabilityJudgement;
  now: string;
}

export interface ClearQuarantineResult {
  registry: FlakyRegistry;
  cleared: boolean;
  reason: string;
}

export function clearQuarantineWithEvidence(input: ClearQuarantineInput): ClearQuarantineResult {
  const { judgement } = input;

  if (judgement.verdict !== 'recovered') {
    return {
      registry: input.registry,
      cleared: false,
      reason:
        judgement.verdict === 'flaky'
          ? 'still-flaky: stability re-runs still flipped'
          : 'still-failing: stability re-runs still failed',
    };
  }

  if (judgement.reruns < 2 || judgement.passes < judgement.reruns) {
    /* v8 ignore next 4 -- defensive: a `recovered` verdict already implies passes === reruns */
    return {
      registry: input.registry,
      cleared: false,
      reason: 'insufficient-evidence: need passing stability re-runs',
    };
  }

  const reason = `empirical-stability: ${judgement.passes}/${judgement.reruns} re-runs passed`;
  return {
    registry: markCleared(input.registry, input.test_id, input.suite, reason, input.now),
    cleared: true,
    reason,
  };
}
