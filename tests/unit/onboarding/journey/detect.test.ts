import { afterEach, describe, expect, it, vi } from 'vitest';

import { STACKS } from '@/core/types/domain.js';
import { Detector } from '@/detection/detector.js';
import { chooseStack, detectProject } from '@/onboarding/journey/detect.js';
import { JourneyRefusal } from '@/onboarding/journey/errors.js';
import { emptyStages } from '@/onboarding/journey/run-store.js';
import type { JourneyRun } from '@/onboarding/journey/types.js';

import { baseRun } from './fixtures/journey.js';

const NOW = new Date('2026-01-01T10:00:00.000Z');

function stubReport(report: Record<string, unknown>): void {
  vi.spyOn(Detector.prototype, 'detect').mockResolvedValue(report as never);
}

function run(setup: JourneyRun['stages']['setup']['status'] = 'not_started'): JourneyRun {
  const stages = emptyStages();
  stages.setup = { status: setup };
  return { ...baseRun({ stages }), revision: 1 };
}

describe('step 1 detect (FR-3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a confident detection with its first three signals and only the capabilities that fit', async () => {
    stubReport({
      detected_stack: 'laravel',
      confidence: 'high',
      detected_capabilities: ['pest', 'flutter-only', 'tailwind'],
      signals: [{ file: 'composer.json' }, { file: 'artisan' }, { file: 'routes' }, { file: 'x' }],
    });
    const outcome = await detectProject('/repo', NOW);
    expect(outcome.needs_ai_choice).toBe(false);
    expect(outcome.candidates).toEqual([]);
    expect(outcome.detection).toEqual({
      stack: 'laravel',
      capabilities: ['pest', 'tailwind'],
      source: 'detector',
      reason:
        'detected with high confidence from {"file":"composer.json"}, {"file":"artisan"}, {"file":"routes"}',
      detected_at: NOW.toISOString(),
    });
  });

  it('gives a reason without signals, and no capabilities for a stack paqad does not know', async () => {
    stubReport({
      detected_stack: 'cobol',
      confidence: 'medium',
      detected_capabilities: ['docker'],
      signals: [],
    });
    const outcome = await detectProject('/repo', NOW);
    expect(outcome.detection?.reason).toBe('detected with medium confidence');
    expect(outcome.detection?.capabilities).toEqual([]);
  });

  it('hands the choice to the AI with every stack as a candidate when unsure or nothing is found', async () => {
    for (const report of [
      { detected_stack: null, confidence: 'high', detected_capabilities: [], signals: [] },
      { detected_stack: 'react', confidence: 'low', detected_capabilities: [], signals: [] },
    ]) {
      stubReport(report);
      const outcome = await detectProject('/repo', NOW);
      expect(outcome.needs_ai_choice).toBe(true);
      expect(outcome.detection).toBeNull();
      expect(outcome.candidates.map((candidate) => candidate.stack)).toEqual([...STACKS]);
      vi.restoreAllMocks();
    }
  });
});

describe('choose-stack refusals (FR-3)', () => {
  const input = {
    stack: 'laravel',
    capabilities: ['pest'],
    reason: '  composer.json and artisan ',
  };

  it('records the AI pick with a trimmed reason', () => {
    expect(chooseStack(run(), input, NOW)).toEqual({
      stack: 'laravel',
      capabilities: ['pest'],
      source: 'ai',
      reason: 'composer.json and artisan',
      detected_at: NOW.toISOString(),
    });
  });

  it('refuses once setup has started, an unknown stack, a capability that does not fit and an empty reason', () => {
    expect(() => chooseStack(run('running'), input, NOW)).toThrow(/cannot change after step 2/u);
    expect(() => chooseStack(run(), { ...input, stack: 'cobol' }, NOW)).toThrow(
      /"cobol" is not a known stack/u,
    );
    expect(() => chooseStack(run(), { ...input, capabilities: ['pest', 'swiftui'] }, NOW)).toThrow(
      'These capabilities do not fit laravel: swiftui',
    );
    expect(() => chooseStack(run(), { ...input, reason: '   ' }, NOW)).toThrow(JourneyRefusal);
  });
});
