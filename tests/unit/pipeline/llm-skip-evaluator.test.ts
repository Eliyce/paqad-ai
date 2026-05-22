import { describe, expect, it } from 'vitest';

import { shouldSkipLlm } from '@/pipeline/llm-skip-evaluator.js';

describe('shouldSkipLlm', () => {
  const basePreResult = {
    resolved: {
      workflow: 'cleanup' as const,
      affected_modules_source: 'explicit-path',
      matched_rule_triggers: [],
      delta_candidate: false,
    },
    hints: {},
    unresolved: [],
    resolution_map: {},
    evidence: [],
  };

  it('skips when confidence is high and all gates pass', () => {
    expect(
      shouldSkipLlm(basePreResult as never, 0.9, 'rename src/file.ts', {
        workflow: 'deterministic',
        scope: 'deterministic:graph',
        database_impact: 'deterministic',
        api_impact: 'deterministic',
        ui_impact: 'deterministic',
      }),
    ).toBe(true);
  });

  it('does not skip for ambiguous wording or low confidence', () => {
    expect(
      shouldSkipLlm(basePreResult as never, 0.8, 'maybe rename this?', {
        workflow: 'deterministic',
        scope: 'deterministic:graph',
        database_impact: 'deterministic',
        api_impact: 'deterministic',
        ui_impact: 'deterministic',
      }),
    ).toBe(false);
  });

  it('does not skip for sensitive triggers, delta work, or non-fast workflows', () => {
    expect(
      shouldSkipLlm(
        {
          ...basePreResult,
          resolved: {
            ...basePreResult.resolved,
            workflow: 'feature-development',
            matched_rule_triggers: ['security'],
          },
        } as never,
        0.95,
        'implement auth',
        {
          workflow: 'deterministic',
          scope: 'deterministic:graph',
          database_impact: 'deterministic',
          api_impact: 'deterministic',
          ui_impact: 'deterministic',
        },
      ),
    ).toBe(false);

    expect(
      shouldSkipLlm(
        {
          ...basePreResult,
          resolved: { ...basePreResult.resolved, delta_candidate: true },
        } as never,
        0.95,
        'cleanup',
        {
          workflow: 'deterministic',
          scope: 'deterministic:graph',
          database_impact: 'deterministic',
          api_impact: 'deterministic',
          ui_impact: 'deterministic',
        },
      ),
    ).toBe(false);
  });
});
