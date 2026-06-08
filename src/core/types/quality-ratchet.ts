// Quality-ratchet types. Issue #110 — "make sure quality can only improve,
// never quietly slip."
//
// paqad records where four quality measures stand today (the baseline = the
// project's real level, not an ideal) and from then on only allows a change
// that keeps each measure equal or better. The recorded level can get stricter
// (the ratchet tightens); it never loosens, except via a recorded, approved
// exception.
//
// One normalisation makes the whole rule trivial and impossible to get
// backwards: every measure is expressed as a *deficiency count* where **lower
// is always better** —
//   - tangledness    → count of complexity violations
//   - dead_code      → count of orphan/unused files (consumed from #109)
//   - risky_patterns → count of risky-pattern / security findings
//   - strictness     → count of strict flags that are *off* (looseness)
// so "worse" is unambiguously "the number went up" for all four.
//
// This file owns the data shapes only. Collection lives in
// `src/quality-ratchet/collector.ts` (+ `strictness.ts`), the baseline I/O in
// `baseline.ts`, the pure ratchet comparison in `ratchet.ts`, the exception
// Decision Packet in `exception-decision.ts`, and orchestration in `runner.ts`.

import type { Lane } from './routing.js';

export const QUALITY_MEASURES = [
  'tangledness',
  'dead_code',
  'risky_patterns',
  'strictness',
] as const;
export type QualityMeasure = (typeof QUALITY_MEASURES)[number];

// How much to trust a measure's value. A mature per-language tool produces
// `mature`; a stack with weak/absent tooling produces `lower` so nobody
// over-trusts the number (mirrors mutation-testing confidence, issue #105).
export const MEASURE_CONFIDENCE_LEVELS = ['mature', 'lower'] as const;
export type MeasureConfidence = (typeof MEASURE_CONFIDENCE_LEVELS)[number];

// Module slug used for project-wide measures (e.g. strictness, which is a
// single tsconfig-level setting that does not belong to one module).
export const PROJECT_SCOPE = '(project)';

// One measured deficiency for a measure within a module (or PROJECT_SCOPE).
export interface MeasureSample {
  measure: QualityMeasure;
  /** Module slug, or PROJECT_SCOPE for project-wide measures. */
  module: string;
  /**
   * Deficiency count; lower is better across every measure. `null` means the
   * measure could not be computed (no tool wired for this stack) — a null value
   * never blocks the gate and is recorded with its reason for honesty.
   */
  value: number | null;
  confidence: MeasureConfidence;
  /** The tool/metric that produced the value, for auditability. */
  tool: string | null;
  /** Why `value` is null, when it is. */
  blocked_reason: string | null;
}

export const QUALITY_BASELINE_SCHEMA_VERSION = '1.0.0' as const;

// `.paqad/quality-baseline.json`. The ratchet's recorded level: the lowest
// (best) deficiency seen per measure+module. It only ever moves down.
export interface QualityBaseline {
  schema_version: typeof QUALITY_BASELINE_SCHEMA_VERSION;
  /** When the baseline was first captured (today's reality). */
  captured_at: string;
  /** When it was last tightened. */
  updated_at: string;
  /** Best-known deficiency per measure+module. */
  samples: MeasureSample[];
}

// What happened to one measure+module this run, comparing current vs. baseline.
export type RatchetMeasureOutcome =
  // No baseline entry yet — captured this run, never blocks (day-one reality).
  | 'new'
  // current === baseline.
  | 'unchanged'
  // current < baseline — the recorded level tightens.
  | 'tightened'
  // current > baseline — a worsening; blocks unless an exception is approved.
  | 'regressed'
  // current value could not be measured — recorded, never blocks.
  | 'blocked';

export interface RatchetMeasureVerdict {
  measure: QualityMeasure;
  module: string;
  baseline_value: number | null;
  current_value: number | null;
  outcome: RatchetMeasureOutcome;
  confidence: MeasureConfidence;
  /**
   * The exception "kind" key — a regression of the same kind reuses an earlier
   * approval via the Decision Pause Contract (issue #110: approve once, reuse by
   * kind). Keyed by measure so "loosening strictness" reuses across modules.
   */
  kind: string;
  detail: string;
}

export type QualityRatchetStatus =
  // Every evaluated measure held equal-or-better (or only tightened).
  | 'pass'
  // At least one measure worsened with no approved exception → blocks.
  | 'regressed'
  // No baseline existed; today's reality was captured. Never blocks.
  | 'captured'
  // The ratchet did not run (no measures evaluable, etc.).
  | 'skipped';

// The full ratchet result, planted on the verification context like
// `mutation_result` and read by the gate.
export interface QualityRatchetResult {
  status: QualityRatchetStatus;
  lane: Lane;
  /** Every measure+module evaluated this run. */
  verdicts: RatchetMeasureVerdict[];
  /** Regressions with no approved exception — these block. */
  blocking_regressions: RatchetMeasureVerdict[];
  /** Regressions permitted by a reused/approved exception — recorded, not blocking. */
  excepted_regressions: RatchetMeasureVerdict[];
  /** Measures whose recorded level improved (baseline tightened). */
  tightened: RatchetMeasureVerdict[];
  /** True iff a baseline was captured (first run) or extended with new measures. */
  captured_baseline: boolean;
  skipped_reason: string | null;
}
