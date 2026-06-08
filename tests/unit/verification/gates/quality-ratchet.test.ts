import { describe, expect, it } from 'vitest';

import type { QualityRatchetResult, RatchetMeasureVerdict } from '@/core/types/quality-ratchet.js';
import { QualityRatchetGate } from '@/verification/gates/quality-ratchet.js';

import { createVerificationContext } from '../shared.fixture.js';

function verdict(overrides: Partial<RatchetMeasureVerdict> = {}): RatchetMeasureVerdict {
  return {
    measure: 'strictness',
    module: '(project)',
    baseline_value: 2,
    current_value: 5,
    outcome: 'regressed',
    confidence: 'mature',
    kind: 'quality.strictness',
    detail: 'strictness @ (project): worsened 2 → 5 (lower is better).',
    ...overrides,
  };
}

function result(overrides: Partial<QualityRatchetResult> = {}): QualityRatchetResult {
  return {
    status: 'pass',
    lane: 'full',
    verdicts: [],
    blocking_regressions: [],
    excepted_regressions: [],
    tightened: [],
    captured_baseline: false,
    skipped_reason: null,
    ...overrides,
  };
}

describe('QualityRatchetGate', () => {
  const gate = new QualityRatchetGate();

  it('passes (inert) when no ratchet result is present', async () => {
    const r = await gate.check(createVerificationContext());
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('did not run');
  });

  it('passes when skipped, naming the reason', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({ status: 'skipped', skipped_reason: 'nothing-to-compare' }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('nothing-to-compare');
  });

  it('passes and explains when the baseline was just captured', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          status: 'captured',
          captured_baseline: true,
          verdicts: [verdict({ outcome: 'new' })],
        }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('captured');
  });

  it('passes and reports tightenings when every measure held', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({ tightened: [verdict({ outcome: 'tightened' })] }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('tightened');
  });

  it('fails when a measure worsened with no approved exception', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({ status: 'regressed', blocking_regressions: [verdict()] }),
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('strictness@(project)');
    expect(r.remediation).toContain('quality.ratchet_exception');
  });

  it('notes approved exceptions alongside a remaining block', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          status: 'regressed',
          blocking_regressions: [verdict({ measure: 'dead_code', kind: 'quality.dead_code' })],
          excepted_regressions: [verdict()],
        }),
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('approved exception');
  });

  it('truncates a long block list', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      verdict({ measure: 'tangledness', module: `m${i}`, kind: 'quality.tangledness' }),
    );
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({ status: 'regressed', blocking_regressions: many }),
      }),
    );
    expect(r.detail).toContain('+2 more');
  });
});
