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

  it('reads did not run (never a pass) when no ratchet result is present', async () => {
    const r = await gate.check(createVerificationContext());
    expect(r.passed).toBe(true);
    expect(r.outcome).toBe('did-not-run');
    expect(r.detail).toContain('did not run');
  });

  it('reads did not run when skipped, naming the reason', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({ status: 'skipped', skipped_reason: 'nothing-to-compare' }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.outcome).toBe('did-not-run');
    expect(r.detail).toContain('nothing-to-compare');
  });

  it('reads did not run with the default reason when a skip names none', async () => {
    const r = await gate.check(
      createVerificationContext({ quality_ratchet_result: result({ status: 'skipped' }) }),
    );
    expect(r.outcome).toBe('did-not-run');
    expect(r.detail).toContain('no measures to evaluate');
  });

  it('AC-13: a fast-lane result says strictness only', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          lane: 'fast',
          verdicts: [verdict({ outcome: 'unchanged', current_value: 2 })],
        }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.outcome).toBeUndefined();
    expect(r.detail).toContain('strictness only');
  });

  it('AC-13: a graduated-lane result names each measure taken and each blocked measure', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          lane: 'graduated',
          verdicts: [
            verdict({ outcome: 'unchanged', current_value: 2 }),
            verdict({ measure: 'tangledness', outcome: 'tightened', current_value: 1 }),
            verdict({ measure: 'dead_code', outcome: 'blocked', current_value: null }),
          ],
        }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('measured: strictness, tangledness');
    expect(r.detail).toContain('blocked: dead code');
    expect(r.detail).not.toContain('strictness only');
  });

  it('AC-13: a captured baseline lists the measures it took', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          status: 'captured',
          captured_baseline: true,
          verdicts: [
            verdict({ outcome: 'new' }),
            verdict({ measure: 'risky_patterns', outcome: 'new', current_value: null }),
          ],
        }),
      }),
    );
    expect(r.detail).toContain('captured');
    expect(r.detail).toContain('measured: strictness');
    expect(r.detail).toContain('blocked: risky patterns');
  });

  it('AC-14: a result whose every measure is blocked reads did not run, not a pass', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          verdicts: [
            verdict({ outcome: 'blocked', current_value: null }),
            verdict({ measure: 'dead_code', outcome: 'blocked', current_value: null }),
          ],
        }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.outcome).toBe('did-not-run');
    expect(r.detail).toContain('no quality measure could be taken');
    expect(r.detail).toContain('blocked: strictness, dead code');
  });

  it('AC-14: a captured baseline that took no measure reads did not run', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          status: 'captured',
          captured_baseline: true,
          verdicts: [verdict({ outcome: 'new', current_value: null })],
        }),
      }),
    );
    expect(r.outcome).toBe('did-not-run');
  });

  it('AC-14: a result with no measures at all reads did not run', async () => {
    const r = await gate.check(createVerificationContext({ quality_ratchet_result: result() }));
    expect(r.outcome).toBe('did-not-run');
    expect(r.detail).not.toContain('blocked:');
  });

  it('reads did not run when the baseline was just captured, since nothing was compared', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          status: 'captured',
          captured_baseline: true,
          verdicts: [verdict({ outcome: 'new' })],
        }),
      }),
    );
    expect(r.outcome).toBe('did-not-run');
    expect(r.detail).toContain('captured');
  });

  it('passes and reports tightenings when every measure held', async () => {
    const r = await gate.check(
      createVerificationContext({
        quality_ratchet_result: result({
          verdicts: [verdict({ outcome: 'tightened', current_value: 1 })],
          tightened: [verdict({ outcome: 'tightened', current_value: 1 })],
          excepted_regressions: [verdict()],
        }),
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('tightened');
    expect(r.detail).toContain('1 measure compared');
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
