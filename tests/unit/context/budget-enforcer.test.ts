import { describe, expect, it } from 'vitest';

import { ContextBudgetEnforcer } from '@/context/budget-enforcer.js';
import { DEFAULT_CONTEXT_BUDGET } from '@/core/constants/budgets.js';

describe('ContextBudgetEnforcer', () => {
  const enforcer = new ContextBudgetEnforcer({ main_agent_max: 30000 });

  it('uses the shared default context budget contract', () => {
    const defaultEnforcer = new ContextBudgetEnforcer();
    expect(defaultEnforcer['budget']).toEqual(DEFAULT_CONTEXT_BUDGET);
  });

  it('adapts the budget for the selected fast model tier', () => {
    const fastEnforcer = ContextBudgetEnforcer.fromProfile(
      {
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'o3-pro',
          fast_model: 'gpt-5-mini',
        },
      },
      'fast',
    );

    expect(fastEnforcer['budget']).toMatchObject({
      main_agent_max: 18000,
      skills_per_session: 2000,
      compaction_trigger_pct: 0.7,
    });
  });

  it('adapts the budget for the selected reasoning model tier', () => {
    const reasoningEnforcer = ContextBudgetEnforcer.fromProfile(
      {
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'o3-pro',
          fast_model: 'gpt-5-mini',
        },
      },
      'reasoning',
    );

    expect(reasoningEnforcer['budget']).toMatchObject({
      main_agent_max: 45000,
      skills_per_session: 4000,
      compaction_trigger_pct: 0.85,
    });
  });

  it('keeps the standard budget for the medium model tier', () => {
    const defaultTierEnforcer = ContextBudgetEnforcer.fromProfile({
      model_routing: {
        default_model: 'gpt-5',
        reasoning_model: 'o3-pro',
        fast_model: 'gpt-5-mini',
      },
    });

    expect(defaultTierEnforcer['budget']).toEqual(DEFAULT_CONTEXT_BUDGET);
  });

  it('returns ok when under 80% of budget', () => {
    const result = enforcer.checkBudget(20000);
    expect(result.verdict).toBe('ok');
  });

  it('returns warning at 80-100% of budget', () => {
    const result = enforcer.checkBudget(27000);
    expect(result.verdict).toBe('warning');
  });

  it('returns requires-justification at 100-120% of budget', () => {
    const result = enforcer.checkBudget(33000);
    expect(result.verdict).toBe('requires-justification');
  });

  it('returns blocked over 120% of budget', () => {
    const result = enforcer.checkBudget(40000);
    expect(result.verdict).toBe('blocked');
  });

  it('shouldCompact returns true at 80% threshold', () => {
    expect(enforcer.shouldCompact(24000)).toBe(true);
    expect(enforcer.shouldCompact(20000)).toBe(false);
  });

  it('uses custom budget config when provided', () => {
    const custom = new ContextBudgetEnforcer({ main_agent_max: 10000 });
    const result = custom.checkBudget(9000);
    expect(result.verdict).toBe('warning');
  });

  it('treats a zero budget as non-compacting and exposes legacy decisions through evaluate', () => {
    const zeroBudget = new ContextBudgetEnforcer({ main_agent_max: 0 });
    expect(zeroBudget.checkBudget(500).verdict).toBe('ok');
    expect(zeroBudget.shouldCompact(500)).toBe(false);

    expect(enforcer.evaluate(1000)).toEqual({ decision: 'allow', usage_ratio: 1000 / 30000 });
    expect(enforcer.evaluate(27000)).toEqual({ decision: 'warn', usage_ratio: 0.9 });
    expect(enforcer.evaluate(33000)).toEqual({
      decision: 'require-justification',
      usage_ratio: 1.1,
    });
    expect(enforcer.evaluate(40000)).toEqual({
      decision: 'block',
      usage_ratio: 40000 / 30000,
    });
  });
});
