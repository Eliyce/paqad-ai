import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tempRoot } from './journey/fixtures/journey.js';

const compileState = vi.hoisted(() => ({ fail: false }));

vi.mock('@/rule-scripts/compile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/rule-scripts/compile.js')>();
  return {
    ...actual,
    isRuleScriptMapStale: () => true,
    compileRuleScripts: () => {
      if (compileState.fail) throw new Error('map is broken');
    },
  };
});

const { compileOnboardingRules } = await import('../../../src/onboarding/orchestrator.js');
const { ragIndexDeferred, resolveRagSelection } =
  await import('../../../src/onboarding/rag-onboarding.js');

describe('orchestrator additions for the onboarding journey', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-orchestrator-');
    compileState.fail = false;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('FR-15: returns a structured step failure for a failed compile step, keeping the warning', async () => {
    compileState.fail = true;
    const result = await compileOnboardingRules(root);
    expect(result.step_failures).toContainEqual({
      step: 'rule_script_map',
      message: 'map is broken',
    });
    expect(
      result.warnings.some((line) => line.includes('Rule-script map compilation failed')),
    ).toBe(true);
  });

  it('FR-15: a clean compile has no rule-script map failure', async () => {
    const result = await compileOnboardingRules(root);
    expect(result.step_failures.map((failure) => failure.step)).not.toContain('rule_script_map');
  });

  it('FR-15: a deferred index preset survives resolution and is reported as deferred', async () => {
    const selection = await resolveRagSelection('coding', {
      enabled: true,
      provider: 'local',
      index: 'defer',
    });
    expect(selection?.index).toBe('defer');
    expect(ragIndexDeferred(selection)).toBe(true);
    const now = await resolveRagSelection('coding', { enabled: true, provider: 'local' });
    expect(ragIndexDeferred(now)).toBe(false);
    expect(ragIndexDeferred({ enabled: false, index: 'defer' })).toBe(false);
  });
});
