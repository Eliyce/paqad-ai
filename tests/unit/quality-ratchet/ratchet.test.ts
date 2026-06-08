import { describe, expect, it } from 'vitest';

import {
  PROJECT_SCOPE,
  QUALITY_MEASURES,
  type MeasureSample,
} from '@/core/types/quality-ratchet.js';
import { createBaseline } from '@/quality-ratchet/baseline.js';
import { evaluateRatchet, exceptionKind } from '@/quality-ratchet/ratchet.js';

function sample(measure: string, module: string, value: number | null): MeasureSample {
  return {
    measure: measure as MeasureSample['measure'],
    module,
    value,
    confidence: 'mature',
    tool: null,
    blocked_reason: value === null ? 'tool-not-wired' : null,
  };
}

describe('evaluateRatchet', () => {
  it('captures today reality on the first run (no baseline) and never blocks', () => {
    const result = evaluateRatchet({
      baseline: null,
      current: [sample('strictness', PROJECT_SCOPE, 12)],
      lane: 'full',
    });
    expect(result.status).toBe('captured');
    expect(result.captured_baseline).toBe(true);
    expect(result.blocking_regressions).toHaveLength(0);
    expect(result.verdicts[0]?.outcome).toBe('new');
  });

  it('passes when a measure is unchanged', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 4)], 'now');
    const result = evaluateRatchet({
      baseline,
      current: [sample('dead_code', 'core', 4)],
      lane: 'full',
    });
    expect(result.status).toBe('pass');
    expect(result.verdicts[0]?.outcome).toBe('unchanged');
  });

  it('records a tightening when a measure improves', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 4)], 'now');
    const result = evaluateRatchet({
      baseline,
      current: [sample('dead_code', 'core', 1)],
      lane: 'full',
    });
    expect(result.status).toBe('pass');
    expect(result.tightened).toHaveLength(1);
    expect(result.verdicts[0]?.outcome).toBe('tightened');
  });

  it.each(QUALITY_MEASURES)('refuses a change that worsens %s', (measure) => {
    const baseline = createBaseline([sample(measure, PROJECT_SCOPE, 2)], 'now');
    const result = evaluateRatchet({
      baseline,
      current: [sample(measure, PROJECT_SCOPE, 5)],
      lane: 'full',
    });
    expect(result.status).toBe('regressed');
    expect(result.blocking_regressions).toHaveLength(1);
    expect(result.blocking_regressions[0]?.measure).toBe(measure);
    expect(result.blocking_regressions[0]?.detail).toContain('worsened');
  });

  it('permits a worsening when an exception for that kind is approved', () => {
    const baseline = createBaseline([sample('strictness', PROJECT_SCOPE, 2)], 'now');
    const result = evaluateRatchet({
      baseline,
      current: [sample('strictness', PROJECT_SCOPE, 5)],
      lane: 'full',
      approvedExceptionKinds: new Set([exceptionKind('strictness')]),
    });
    expect(result.status).toBe('pass');
    expect(result.blocking_regressions).toHaveLength(0);
    expect(result.excepted_regressions).toHaveLength(1);
  });

  it('records a measure that could not be measured as blocked, never failing', () => {
    const baseline = createBaseline([sample('tangledness', PROJECT_SCOPE, 3)], 'now');
    const result = evaluateRatchet({
      baseline,
      current: [sample('tangledness', PROJECT_SCOPE, null)],
      lane: 'full',
    });
    expect(result.status).toBe('pass');
    expect(result.verdicts[0]?.outcome).toBe('blocked');
  });

  it('captures a brand-new measure against an existing baseline without failing', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 1)], 'now');
    const result = evaluateRatchet({
      baseline,
      current: [sample('strictness', PROJECT_SCOPE, 9)],
      lane: 'full',
    });
    expect(result.status).toBe('pass');
    expect(result.captured_baseline).toBe(true);
    expect(result.verdicts[0]?.outcome).toBe('new');
  });

  it('keys the exception kind by measure', () => {
    expect(exceptionKind('strictness')).toBe('quality.strictness');
  });
});
