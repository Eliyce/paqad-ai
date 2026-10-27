import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PAQAD_LIVE_HOOKS } from '@/adapters/shared/paqad-hooks.js';
import { RULE_GATE_DEFAULTS, generateConfigExample } from '@/core/framework-config.js';

const RULE_GATE_LINES = [
  '# rule_gate_pre_edit=blocking-only',
  '# rule_gate_concurrency=auto',
  '# rule_gate_budget_ms=6000',
];

function ruleGateLines(text: string): string[] {
  return text.split('\n').filter((line) => /^#\s*rule_gate_\w+=/u.test(line));
}

describe('rule gate config contract', () => {
  it('AC-40: the pre-mutation capability gate stays fail-closed at 10s and the max rule-gate budget stays below it', () => {
    const hook = PAQAD_LIVE_HOOKS.find((spec) => spec.id === 'capability-gate-pre-mutation');
    expect(hook).toBeDefined();
    expect(hook?.failClosed).toBe(true);
    expect(hook?.timeoutSec).toBe(10);
    expect(RULE_GATE_DEFAULTS.max_budget_ms).toBe(9000);
    expect(RULE_GATE_DEFAULTS.max_budget_ms).toBeLessThan((hook?.timeoutSec ?? 0) * 1000);
  });

  it('AC-64: .config.example carries the three rule_gate_* defaults and matches the generator', () => {
    const committed = readFileSync(join(process.cwd(), '.paqad', '.config.example'), 'utf8');
    expect(ruleGateLines(committed)).toEqual(RULE_GATE_LINES);
    expect(ruleGateLines(generateConfigExample('0.0.0'))).toEqual(ruleGateLines(committed));
  });
});
