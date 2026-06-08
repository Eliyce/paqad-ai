import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROJECT_SCOPE, type MeasureSample } from '@/core/types/quality-ratchet.js';
import {
  applyApprovedRegressions,
  createBaseline,
  qualityBaselinePath,
  readQualityBaseline,
  sampleKey,
  tightenBaseline,
  writeQualityBaseline,
} from '@/quality-ratchet/baseline.js';

const NOW = '2026-06-08T00:00:00.000Z';
const LATER = '2026-06-09T00:00:00.000Z';

function sample(measure: string, module: string, value: number | null): MeasureSample {
  return {
    measure: measure as MeasureSample['measure'],
    module,
    value,
    confidence: 'mature',
    tool: 'tsconfig',
    blocked_reason: null,
  };
}

describe('quality baseline', () => {
  it('builds a sorted baseline from samples', () => {
    const baseline = createBaseline(
      [sample('strictness', PROJECT_SCOPE, 7), sample('dead_code', 'core', 2)],
      NOW,
    );
    expect(baseline.captured_at).toBe(NOW);
    expect(baseline.samples.map((s) => s.measure)).toEqual(['dead_code', 'strictness']);
  });

  it('tightens a measure to the lower value and bumps updated_at', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 5)], NOW);
    const next = tightenBaseline(baseline, [sample('dead_code', 'core', 3)], LATER);
    expect(next.samples[0]?.value).toBe(3);
    expect(next.updated_at).toBe(LATER);
  });

  it('never raises a measure on tighten (worsening is ignored here)', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 5)], NOW);
    const next = tightenBaseline(baseline, [sample('dead_code', 'core', 8)], LATER);
    expect(next.samples[0]?.value).toBe(5);
    expect(next.updated_at).toBe(NOW); // nothing changed
  });

  it('adds a newly-collectable measure without failing', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 5)], NOW);
    const next = tightenBaseline(baseline, [sample('strictness', PROJECT_SCOPE, 7)], LATER);
    expect(next.samples).toHaveLength(2);
    expect(next.updated_at).toBe(LATER);
  });

  it('leaves a recorded value untouched when the measure could not be measured', () => {
    const baseline = createBaseline([sample('dead_code', 'core', 5)], NOW);
    const next = tightenBaseline(baseline, [sample('dead_code', 'core', null)], LATER);
    expect(next.samples[0]?.value).toBe(5);
  });

  it('fills a null recorded value when a real value arrives', () => {
    const baseline = createBaseline([sample('dead_code', 'core', null)], NOW);
    const next = tightenBaseline(baseline, [sample('dead_code', 'core', 4)], LATER);
    expect(next.samples[0]?.value).toBe(4);
  });

  it('applyApprovedRegressions is the only path that raises the recorded level', () => {
    const baseline = createBaseline([sample('strictness', PROJECT_SCOPE, 7)], NOW);
    const next = applyApprovedRegressions(
      baseline,
      [sample('strictness', PROJECT_SCOPE, 9)],
      LATER,
    );
    expect(next.samples[0]?.value).toBe(9);
    expect(next.updated_at).toBe(LATER);
  });

  it('applyApprovedRegressions is a no-op with no approvals', () => {
    const baseline = createBaseline([sample('strictness', PROJECT_SCOPE, 7)], NOW);
    expect(applyApprovedRegressions(baseline, [], LATER)).toBe(baseline);
  });

  it('round-trips through disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-baseline-'));
    const baseline = createBaseline([sample('strictness', PROJECT_SCOPE, 7)], NOW);
    const written = await writeQualityBaseline(root, baseline);
    expect(written).toBe(qualityBaselinePath(root));
    expect(await readQualityBaseline(root)).toEqual(baseline);
  });

  it('returns null when the baseline is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-baseline-absent-'));
    expect(await readQualityBaseline(root)).toBeNull();
  });

  it('returns null for a corrupt or wrong-schema baseline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-baseline-corrupt-'));
    mkdirSync(dirname(qualityBaselinePath(root)), { recursive: true });
    writeFileSync(qualityBaselinePath(root), 'not json');
    expect(await readQualityBaseline(root)).toBeNull();
    writeFileSync(qualityBaselinePath(root), JSON.stringify({ schema_version: '9.9.9' }));
    expect(await readQualityBaseline(root)).toBeNull();
  });

  it('builds stable sample keys', () => {
    expect(sampleKey('strictness', PROJECT_SCOPE)).toBe('strictness::(project)');
  });
});
