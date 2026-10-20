import type { Lane } from './routing.js';

export const QUALITY_MEASURES = [
  'tangledness',
  'dead_code',
  'risky_patterns',
  'strictness',
] as const;
export type QualityMeasure = (typeof QUALITY_MEASURES)[number];

export const MEASURE_CONFIDENCE_LEVELS = ['mature', 'lower'] as const;
export type MeasureConfidence = (typeof MEASURE_CONFIDENCE_LEVELS)[number];

export const PROJECT_SCOPE = '(project)';

export interface MeasureSample {
  measure: QualityMeasure;
  module: string;
  value: number | null;
  confidence: MeasureConfidence;
  tool: string | null;
  blocked_reason: string | null;
}

export const QUALITY_BASELINE_SCHEMA_VERSION = '1.0.0' as const;

export interface QualityBaseline {
  schema_version: typeof QUALITY_BASELINE_SCHEMA_VERSION;
  captured_at: string;
  updated_at: string;
  samples: MeasureSample[];
}

export type RatchetMeasureOutcome = 'new' | 'unchanged' | 'tightened' | 'regressed' | 'blocked';

export interface RatchetMeasureVerdict {
  measure: QualityMeasure;
  module: string;
  baseline_value: number | null;
  current_value: number | null;
  outcome: RatchetMeasureOutcome;
  confidence: MeasureConfidence;
  kind: string;
  detail: string;
}

export type QualityRatchetStatus = 'pass' | 'regressed' | 'captured' | 'skipped';

export interface QualityRatchetResult {
  status: QualityRatchetStatus;
  lane: Lane;
  verdicts: RatchetMeasureVerdict[];
  blocking_regressions: RatchetMeasureVerdict[];
  excepted_regressions: RatchetMeasureVerdict[];
  tightened: RatchetMeasureVerdict[];
  captured_baseline: boolean;
  skipped_reason: string | null;
}
