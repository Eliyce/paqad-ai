import type { Lane } from '@/core/types/routing.js';
import {
  type MeasureSample,
  type QualityBaseline,
  type QualityRatchetResult,
  type RatchetMeasureOutcome,
  type RatchetMeasureVerdict,
} from '@/core/types/quality-ratchet.js';

import { sampleKey } from './baseline.js';

export interface EvaluateRatchetOptions {
  baseline: QualityBaseline | null;
  current: MeasureSample[];
  lane: Lane;
  approvedExceptionKinds?: ReadonlySet<string>;
}

export function exceptionKind(measure: string): string {
  return `quality.${measure}`;
}

export function evaluateRatchet(options: EvaluateRatchetOptions): QualityRatchetResult {
  const { current, lane } = options;
  const approved = options.approvedExceptionKinds ?? new Set<string>();

  if (options.baseline === null) {
    const verdicts = current.map<RatchetMeasureVerdict>((sample) => verdict(sample, null, 'new'));
    return {
      status: 'captured',
      lane,
      verdicts,
      blocking_regressions: [],
      excepted_regressions: [],
      tightened: [],
      captured_baseline: true,
      skipped_reason: null,
    };
  }

  const baselineByKey = new Map<string, MeasureSample>();
  for (const sample of options.baseline.samples) {
    baselineByKey.set(sampleKey(sample.measure, sample.module), sample);
  }

  const verdicts: RatchetMeasureVerdict[] = [];
  const blocking: RatchetMeasureVerdict[] = [];
  const excepted: RatchetMeasureVerdict[] = [];
  const tightened: RatchetMeasureVerdict[] = [];
  let capturedNew = false;

  for (const sample of current) {
    const base = baselineByKey.get(sampleKey(sample.measure, sample.module)) ?? null;
    const baseValue = base?.value ?? null;

    if (sample.value === null) {
      verdicts.push(verdict(sample, baseValue, 'blocked'));
      continue;
    }

    if (base === undefined || baseValue === null) {
      verdicts.push(verdict(sample, baseValue, 'new'));
      capturedNew = true;
      continue;
    }

    if (sample.value < baseValue) {
      const v = verdict(sample, baseValue, 'tightened');
      verdicts.push(v);
      tightened.push(v);
    } else if (sample.value === baseValue) {
      verdicts.push(verdict(sample, baseValue, 'unchanged'));
    } else {
      const v = verdict(sample, baseValue, 'regressed');
      verdicts.push(v);
      if (approved.has(v.kind)) {
        excepted.push(v);
      } else {
        blocking.push(v);
      }
    }
  }

  const status = blocking.length > 0 ? 'regressed' : 'pass';

  return {
    status,
    lane,
    verdicts,
    blocking_regressions: blocking,
    excepted_regressions: excepted,
    tightened,
    captured_baseline: capturedNew,
    skipped_reason: null,
  };
}

function verdict(
  sample: MeasureSample,
  baselineValue: number | null,
  outcome: RatchetMeasureOutcome,
): RatchetMeasureVerdict {
  return {
    measure: sample.measure,
    module: sample.module,
    baseline_value: baselineValue,
    current_value: sample.value,
    outcome,
    confidence: sample.confidence,
    kind: exceptionKind(sample.measure),
    detail: detailFor(sample, baselineValue, outcome),
  };
}

function detailFor(
  sample: MeasureSample,
  baselineValue: number | null,
  outcome: RatchetMeasureOutcome,
): string {
  const where = `${sample.measure} @ ${sample.module}`;
  switch (outcome) {
    case 'new':
      return `${where}: captured at ${fmt(sample.value)} (no prior baseline).`;
    case 'blocked':
      return `${where}: not measured this run (${sample.blocked_reason ?? 'unavailable'}).`;
    case 'tightened':
      return `${where}: improved ${fmt(baselineValue)} → ${fmt(sample.value)}; recorded level tightens.`;
    case 'unchanged':
      return `${where}: held at ${fmt(sample.value)}.`;
    case 'regressed':
      return `${where}: worsened ${fmt(baselineValue)} → ${fmt(sample.value)} (lower is better).`;
  }
}

function fmt(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}
