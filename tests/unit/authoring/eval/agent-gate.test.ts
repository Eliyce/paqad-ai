import { describe, expect, it } from 'vitest';

import {
  cheapestPassingTier,
  judgeAgentS5Gate,
  memoryDecision,
  type AgentArmMetrics,
} from '@/authoring/eval/passk.js';

function arm(overrides: Partial<AgentArmMetrics> = {}): AgentArmMetrics {
  return { pass_hat_k: 1, tokens_median: 1000, cost_median: 0.01, latency_ms: 2000, ...overrides };
}

const BASE = { passKThreshold: 0.9, minGainPoints: 10, maxCostMultiple: 4 };

describe('judgeAgentS5Gate (FR-16, A19)', () => {
  it('AC-56: a new agent beating the baseline by exactly 10 points passes and by 9.9 fails as no gain', () => {
    const exactly = judgeAgentS5Gate({
      ...BASE,
      agent: arm({ pass_hat_k: 0.95 }),
      baseline: arm({ pass_hat_k: 0.85 }),
    });
    expect(exactly).toMatchObject({ passed: true, no_gain: false });
    const short = judgeAgentS5Gate({
      ...BASE,
      agent: arm({ pass_hat_k: 0.95 }),
      baseline: arm({ pass_hat_k: 0.851 }),
    });
    expect(short.passed).toBe(false);
    expect(short.no_gain).toBe(true);
    expect(short.reasons[0]).toMatch(/^no gain: pass\^3 beat the baseline by 9\.9 points/);
  });

  it('AC-32, EC-A08: a baseline matching the agent is no gain', () => {
    const result = judgeAgentS5Gate({ ...BASE, agent: arm(), baseline: arm() });
    expect(result.no_gain).toBe(true);
  });

  it('AC-55: pass^3 under the class threshold fails, exactly at it passes', () => {
    expect(
      judgeAgentS5Gate({
        ...BASE,
        agent: arm({ pass_hat_k: 0.899 }),
        baseline: arm({ pass_hat_k: 0 }),
      }).reasons,
    ).toEqual(['pass^3 is 0.899; it needs 0.9']);
    expect(
      judgeAgentS5Gate({
        ...BASE,
        passKThreshold: 0.95,
        agent: arm({ pass_hat_k: 0.95 }),
        baseline: arm({ pass_hat_k: 0 }),
      }).passed,
    ).toBe(true);
  });

  it('AC-32, AC-56: an edited agent within 20% passes; at 20.1% it fails with both numbers and the previous values', () => {
    const edited = { previous: arm(), tolerance: 0.2 };
    expect(
      judgeAgentS5Gate({ ...BASE, agent: arm({ tokens_median: 1200 }), baseline: arm(), edited })
        .passed,
    ).toBe(true);
    const over = judgeAgentS5Gate({
      ...BASE,
      agent: arm({ tokens_median: 1201, latency_ms: 2402 }),
      baseline: arm(),
      edited,
    });
    expect(over.passed).toBe(false);
    expect(over.reasons).toEqual([
      'tokens per task rose to 1201 from 1000 (20.1%), beyond the 20% tolerance',
      'p95 latency (ms) rose to 2402 from 2000 (20.1%), beyond the 20% tolerance',
    ]);
  });

  it('AC-41: a pass^3 drop beyond tolerance fails for an edited agent', () => {
    const result = judgeAgentS5Gate({
      ...BASE,
      agent: arm({ pass_hat_k: 0.9 }),
      baseline: arm(),
      edited: { previous: arm({ pass_hat_k: 1 }), tolerance: 0.2, passKDropAllowed: 0 },
    });
    expect(result.reasons).toEqual(['pass^3 fell to 0.9 from 1, beyond the 0% tolerance']);
  });

  it('P02: median cost over 4x the baseline fails unless a parallel wall-time gain is shown', () => {
    const input = {
      ...BASE,
      agent: arm({ cost_median: 0.05 }),
      baseline: arm({ pass_hat_k: 0, cost_median: 0.01 }),
    };
    expect(judgeAgentS5Gate(input).reasons).toEqual([
      'median cost is 5x the baseline; the limit is 4x unless a parallel wall-time gain is shown',
    ]);
    expect(judgeAgentS5Gate({ ...input, parallelWallTimeGain: true }).passed).toBe(true);
    expect(
      judgeAgentS5Gate({ ...input, agent: arm({ cost_median: null }) }).checks_not_measured,
    ).toEqual([{ check: 'cost multiple', reason: 'cost unavailable on this host' }]);
  });

  it('the blind comparator must prefer the new version on subjective cases', () => {
    const input = { ...BASE, agent: arm(), baseline: arm({ pass_hat_k: 0 }) };
    expect(judgeAgentS5Gate({ ...input, subjective: { preferred: ['new', 'tie'] } }).passed).toBe(
      false,
    );
    expect(judgeAgentS5Gate({ ...input, subjective: { preferred: ['new'] } }).passed).toBe(true);
  });

  it('an unmeasured regression metric is listed, not failed', () => {
    const result = judgeAgentS5Gate({
      ...BASE,
      agent: arm({ latency_ms: null }),
      baseline: arm(),
      edited: { previous: arm(), tolerance: 0.2 },
    });
    expect(result.passed).toBe(true);
    expect(result.checks_not_measured).toEqual([
      { check: 'p95 latency (ms)', reason: 'unavailable on this host' },
    ]);
  });
});

describe('cheapestPassingTier and memoryDecision', () => {
  it('AC-43: the registered model is the cheapest tier that passed', () => {
    const order = ['fast', 'reasoning'] as const;
    expect(
      cheapestPassingTier(
        [
          { tier: 'fast', passed: false },
          { tier: 'reasoning', passed: true },
        ],
        order,
      ),
    ).toBe('reasoning');
    expect(
      cheapestPassingTier(
        [
          { tier: 'fast', passed: true },
          { tier: 'reasoning', passed: true },
        ],
        order,
      ),
    ).toBe('fast');
    expect(cheapestPassingTier([{ tier: 'fast', passed: false }], order)).toBeNull();
  });

  it('AC-18: keeps memory only when pass^3 rises within the token budget, with both numbers', () => {
    expect(
      memoryDecision({
        withAgent: arm({ pass_hat_k: 0.8 }),
        withMemory: arm({ pass_hat_k: 0.9 }),
        tokenTolerance: 0.2,
      }),
    ).toMatchObject({
      kept: true,
      with_agent_pass_k: 0.8,
      with_agent_memory_pass_k: 0.9,
    });
    expect(memoryDecision({ withAgent: arm(), withMemory: arm(), tokenTolerance: 0.2 }).kept).toBe(
      false,
    );
    expect(
      memoryDecision({
        withAgent: arm({ pass_hat_k: 0.8 }),
        withMemory: arm({ pass_hat_k: 0.9, tokens_median: 1300 }),
        tokenTolerance: 0.2,
      }).reason,
    ).toMatch(/over 1200/);
  });
});
