import type { FlakyRegistry, StabilityJudgement } from '@/core/types/flaky.js';

import { markCleared } from './registry.js';

export interface ClearQuarantineInput {
  registry: FlakyRegistry;
  test_id: string;
  suite: string | null;
  /**
   * The result of re-running the test for stability AFTER the claimed fix, on
   * the current tree. Clearing is gated on this empirical evidence — never on a
   * claim that the fix worked (Microsoft ICSE 2020: claimed flaky fixes often
   * don't reduce flakiness).
   */
  judgement: StabilityJudgement;
  now: string;
}

export interface ClearQuarantineResult {
  registry: FlakyRegistry;
  cleared: boolean;
  reason: string;
}

/**
 * Clears a quarantine only when empirical stability re-runs prove the flake is
 * gone: the post-fix judgement must be `recovered` (passed every bounded re-run)
 * and must actually have re-run more than once. A still-flapping or all-failing
 * result keeps the quarantine in place (the entry is kept either way — quarantine
 * is never silently removed; clearing is an explicit, evidenced status change).
 */
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
