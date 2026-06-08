import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import {
  DEFAULT_STABILITY_RERUNS,
  MAX_STABILITY_RERUNS,
  MIN_STABILITY_RERUNS,
} from '@/core/types/flaky.js';
import {
  clampRerunCount,
  isAmbiguousFlip,
  judgeStability,
  resolveRerunCount,
} from '@/flaky/stability.js';

function fixedRuns(results: boolean[]): (attempt: number) => { passed: boolean } {
  return (attempt: number) => ({ passed: results[attempt] ?? false });
}

describe('judgeStability — assume-real-first', () => {
  it('labels a failure real when every re-run also fails (never "probably flaky")', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 3,
      rerun: fixedRuns([false, false, false]),
    });
    expect(judgement.verdict).toBe('real');
    expect(judgement.failures).toBe(3);
    expect(judgement.passes).toBe(0);
  });

  it('labels a failure flaky only once a re-run flips it to passing', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 4,
      rerun: fixedRuns([false, true, false, true]),
    });
    expect(judgement.verdict).toBe('flaky');
    expect(judgement.passes).toBe(2);
    expect(judgement.failures).toBe(2);
  });

  it('reports recovered (not silently dropped) when every re-run passes', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 3,
      rerun: fixedRuns([true, true, true]),
    });
    expect(judgement.verdict).toBe('recovered');
    expect(judgement.passes).toBe(3);
  });

  it('clamps the re-run count it actually performs', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 999,
      rerun: () => ({ passed: false }),
    });
    expect(judgement.reruns).toBe(MAX_STABILITY_RERUNS);
  });
});

describe('isAmbiguousFlip', () => {
  it('flags a lone failure among passes as ambiguous (rare-real vs flaky)', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 5,
      rerun: fixedRuns([true, true, true, true, false]),
    });
    expect(judgement.verdict).toBe('flaky');
    expect(isAmbiguousFlip(judgement)).toBe(true);
  });

  it('flags a lone pass among failures as ambiguous', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 5,
      rerun: fixedRuns([false, false, false, false, true]),
    });
    expect(isAmbiguousFlip(judgement)).toBe(true);
  });

  it('treats a balanced flip as unambiguous (clearly flaky)', () => {
    const judgement = judgeStability({
      test_id: 't1',
      reruns: 4,
      rerun: fixedRuns([true, true, false, false]),
    });
    expect(isAmbiguousFlip(judgement)).toBe(false);
  });

  it('is never ambiguous for a non-flaky verdict', () => {
    const real = judgeStability({
      test_id: 't1',
      reruns: 3,
      rerun: fixedRuns([false, false, false]),
    });
    expect(isAmbiguousFlip(real)).toBe(false);
  });
});

describe('clampRerunCount', () => {
  it('clamps below the floor and above the ceiling', () => {
    expect(clampRerunCount(0)).toBe(MIN_STABILITY_RERUNS);
    expect(clampRerunCount(1)).toBe(MIN_STABILITY_RERUNS);
    expect(clampRerunCount(100)).toBe(MAX_STABILITY_RERUNS);
  });

  it('rounds and passes through an in-band value', () => {
    expect(clampRerunCount(4.4)).toBe(4);
  });

  it('falls back to the default for a non-finite value', () => {
    expect(clampRerunCount(Number.NaN)).toBe(DEFAULT_STABILITY_RERUNS);
  });
});

describe('resolveRerunCount', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-flaky-rerun-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('defaults when there is no project profile', () => {
    expect(resolveRerunCount(projectRoot)).toBe(DEFAULT_STABILITY_RERUNS);
  });

  it('reads and clamps a project-tuned re-run count', () => {
    const profilePath = join(projectRoot, PATHS.PROJECT_PROFILE);
    mkdirSync(dirname(profilePath), { recursive: true });
    writeFileSync(
      profilePath,
      YAML.stringify({
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
          flaky: { rerun_count: 50 },
        },
      }),
    );
    expect(resolveRerunCount(projectRoot)).toBe(MAX_STABILITY_RERUNS);
  });
});
