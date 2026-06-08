// Issue #110 — read / write / tighten the quality baseline.
//
// The baseline is an artifact: `.paqad/quality-baseline.json`. It records the
// lowest (best) deficiency seen per measure+module. Writes are atomic (temp +
// rename) and a corrupt read returns null rather than throwing — the ratchet
// recaptures from reality on the next run, so a damaged file is never fatal.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  QUALITY_BASELINE_SCHEMA_VERSION,
  type MeasureSample,
  type QualityBaseline,
} from '@/core/types/quality-ratchet.js';

export function qualityBaselinePath(projectRoot: string): string {
  return join(projectRoot, PATHS.QUALITY_BASELINE);
}

/** Stable key for one measure+module sample. */
export function sampleKey(measure: string, module: string): string {
  return `${measure}::${module}`;
}

/** Builds a fresh baseline from the captured samples. */
export function createBaseline(samples: MeasureSample[], now: string): QualityBaseline {
  return {
    schema_version: QUALITY_BASELINE_SCHEMA_VERSION,
    captured_at: now,
    updated_at: now,
    samples: sortSamples(samples),
  };
}

/**
 * Returns the baseline tightened against the current samples: every measure
 * moves to the *lower* (better) of baseline-vs-current, never higher. Measures
 * absent from the baseline are added (a newly-collectable measure captures its
 * reality, never retroactively failing). A measure that could not be measured
 * this run (`value === null`) leaves the recorded value untouched.
 *
 * This is the ratchet: the recorded level only ever moves down. A worsening is
 * never written here — an approved exception lifts the recorded value through
 * `applyApprovedRegressions`, which is the only path that may raise it.
 */
export function tightenBaseline(
  baseline: QualityBaseline,
  current: MeasureSample[],
  now: string,
): QualityBaseline {
  const byKey = new Map<string, MeasureSample>();
  for (const sample of baseline.samples) {
    byKey.set(sampleKey(sample.measure, sample.module), sample);
  }

  let changed = false;
  for (const sample of current) {
    const key = sampleKey(sample.measure, sample.module);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, sample);
      changed = true;
      continue;
    }

    // Can't measure it this run → keep the recorded value as-is.
    if (sample.value === null) continue;

    if (existing.value === null || sample.value < existing.value) {
      byKey.set(key, { ...sample, value: sample.value });
      changed = true;
    }
  }

  return {
    ...baseline,
    samples: sortSamples([...byKey.values()]),
    updated_at: changed ? now : baseline.updated_at,
  };
}

/**
 * Raises the recorded level for measures whose worsening was approved as an
 * exception — the *only* path that may loosen the baseline, and only for the
 * specific measure+module the human signed off. Everything else is left to the
 * ratchet.
 */
export function applyApprovedRegressions(
  baseline: QualityBaseline,
  approved: MeasureSample[],
  now: string,
): QualityBaseline {
  if (approved.length === 0) return baseline;
  const byKey = new Map<string, MeasureSample>();
  for (const sample of baseline.samples) {
    byKey.set(sampleKey(sample.measure, sample.module), sample);
  }
  for (const sample of approved) {
    if (sample.value === null) continue;
    byKey.set(sampleKey(sample.measure, sample.module), { ...sample });
  }
  return {
    ...baseline,
    samples: sortSamples([...byKey.values()]),
    updated_at: now,
  };
}

function sortSamples(samples: MeasureSample[]): MeasureSample[] {
  return [...samples].sort((a, b) =>
    sampleKey(a.measure, a.module).localeCompare(sampleKey(b.measure, b.module)),
  );
}

/** Atomically writes the baseline to `.paqad/quality-baseline.json`. */
export async function writeQualityBaseline(
  projectRoot: string,
  baseline: QualityBaseline,
): Promise<string> {
  const target = qualityBaselinePath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  await rename(tmp, target);
  return target;
}

/** Reads the baseline, or null when absent / corrupt. */
export async function readQualityBaseline(projectRoot: string): Promise<QualityBaseline | null> {
  const target = qualityBaselinePath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as QualityBaseline;
    if (
      parsed?.schema_version !== QUALITY_BASELINE_SCHEMA_VERSION ||
      !Array.isArray(parsed.samples)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
