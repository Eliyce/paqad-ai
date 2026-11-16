import { describe, expect, it } from 'vitest';

import { assembleMap } from '@/rule-scripts/analyzer.js';
import type { RuleScriptMap } from '@/rule-scripts/types.js';

const item = {
  id: 'RL-1',
  source: 'docs/instructions/rules/coding/q.md',
  text: 'No x.',
  text_hash: 'h1',
};

function prior(reason: string): RuleScriptMap {
  return {
    schema_version: 1,
    generated_at: '2026-01-01T00:00:00.000Z',
    rule_files_hash: 'x',
    rules: [
      { ...item, verifiability: { kind: 'unverifiable', reason }, enforced_by: [], scripts: [] },
    ],
  };
}

const deterministic = new Map([
  ['RL-1', { id: 'RL-1', verifiability: { kind: 'deterministic' as const }, enforced_by: [] }],
]);

describe('analyzer keeps the journey’s unverifiable marks', () => {
  it('keeps a prior unverifiable verdict whose reason starts with "onboarding:"', () => {
    const map = assembleMap(
      [item] as never,
      deterministic,
      'y',
      prior('onboarding: fixtures failed'),
    );
    expect(map.rules[0]?.verifiability).toEqual({
      kind: 'unverifiable',
      reason: 'onboarding: fixtures failed',
    });
  });

  it('lets a re-analysis replace any other prior verdict', () => {
    const map = assembleMap([item] as never, deterministic, 'y', prior('needs a person'));
    expect(map.rules[0]?.verifiability).toEqual({ kind: 'deterministic' });
  });
});
