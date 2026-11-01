import { describe, expect, it } from 'vitest';

import {
  combinations,
  judgeAgentS5Gate,
  latencyMeasure,
  memoryDecision,
  passAtK,
  passHatK,
  percentile,
  reliabilityOf,
  reliabilityTable,
  trialPassed,
} from '@/authoring/eval/passk.js';
import { meetsThreshold } from '@/authoring/thresholds.js';

describe('pass^k and pass@k (FR-15, NFR-1)', () => {
  it('AC-55: a case with pass, pass, fail has pass^3 0 and pass@3 1', () => {
    expect(passHatK(3, 2)).toBe(0);
    expect(passAtK(3, 2)).toBe(1);
    expect(passHatK(3, 3)).toBe(1);
    expect(passAtK(3, 0)).toBe(0);
  });

  it('computes C(c,k)/C(n,k) and 1 - C(n-c,k)/C(n,k) for larger samples', () => {
    expect(combinations(5, 3)).toBe(10);
    expect(combinations(2, 3)).toBe(0);
    expect(passHatK(5, 4)).toBeCloseTo(0.4);
    expect(passAtK(5, 1)).toBeCloseTo(0.6);
    expect(passHatK(2, 2)).toBe(0);
  });

  it('AC-55: exactly 0.9 meets the class threshold and 0.899 does not; 0.95 for stage agents', () => {
    expect(meetsThreshold(0.9, 0.9)).toBe(true);
    expect(meetsThreshold(0.899, 0.9)).toBe(false);
    expect(meetsThreshold(0.95, 0.95)).toBe(true);
    expect(meetsThreshold(0.949, 0.95)).toBe(false);
  });

  it('AC-57: a trial cut off by maxTurns or the spend cap fails even with every assertion passed', () => {
    expect(trialPassed({ passed: 2, total: 2 })).toBe(true);
    expect(trialPassed({ passed: 2, total: 2, cut_off: true })).toBe(false);
    expect(trialPassed({ passed: 1, total: 2 })).toBe(false);
    expect(trialPassed({ passed: 0, total: 0 })).toBe(false);
  });

  it('AC-6: averages pass^3 and pass@3 over cases per arm and tier, reported separately', () => {
    const outcomes = [
      ...[true, true, true].map((passed) => ({
        case: 'a',
        arm: 'with_agent',
        tier: 'fast',
        passed,
      })),
      ...[true, true, false].map((passed) => ({
        case: 'b',
        arm: 'with_agent',
        tier: 'fast',
        passed,
      })),
      ...[false, false, false].map((passed) => ({
        case: 'a',
        arm: 'main_thread',
        tier: 'fast',
        passed,
      })),
    ];
    const agent = reliabilityOf(outcomes, 'with_agent', 'fast');
    expect(agent).toMatchObject({ pass_hat_k: 0.5, pass_at_k: 1, k: 3 });
    expect(agent.cases.map((entry) => [entry.case, entry.pass_hat_k])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
    expect(reliabilityTable(outcomes).map((entry) => entry.arm)).toEqual([
      'main_thread',
      'with_agent',
    ]);
  });

  it('FR-60: uses the median below 10 samples and p95 from 10 on, labelling the sample size', () => {
    expect(latencyMeasure([3, 1, 2])).toEqual({ value: 2, measure: 'median', samples: 3 });
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(latencyMeasure(twenty)).toEqual({ value: 19, measure: 'p95', samples: 20 });
    expect(percentile([], 0.95)).toBe(0);
    expect(latencyMeasure([])).toEqual({ value: 0, measure: 'median', samples: 0 });
    expect(latencyMeasure([1, 2]).value).toBe(1.5);
  });
});

describe('agent gate edges', () => {
  const arm = (
    pass: number,
    tokens: number | null,
    cost: number | null = 0.01,
    latency: number | null = 1000,
  ) => ({ pass_hat_k: pass, tokens_median: tokens, cost_median: cost, latency_ms: latency });

  it('pass@k and pass^k are zero with fewer trials than k, and a case-less arm has mean zero', () => {
    expect(passAtK(2, 2)).toBe(0);
    expect(passHatK(2, 2)).toBe(0);
    expect(reliabilityOf([], 'with_agent', 'fast').pass_hat_k).toBe(0);
  });

  it('AC-41: a regression from a zero baseline is an infinite rise', () => {
    const result = judgeAgentS5Gate({
      agent: arm(1, 100),
      baseline: arm(1, 0),
      passKThreshold: 0.8,
      minGainPoints: 0,
      maxCostMultiple: 10,
      edited: { previous: arm(1, 0), tolerance: 0.2 },
    });
    expect(result.reasons.join(' ')).toContain('(Infinity%)');
  });

  it('AC-18: a memory arm is kept when the agent arm has no token number to compare', () => {
    expect(
      memoryDecision({
        withAgent: arm(0.5, null),
        withMemory: arm(1, 900),
        tokenTolerance: 0.2,
      }).kept,
    ).toBe(true);
  });
});
