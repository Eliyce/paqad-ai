import type { ScoreBand } from '../types.js';

/**
 * Thresholds for the phase-1 score-band rubric. Single source of truth so
 * the brief, UI, and CLI all agree.
 *
 * - ≥ 80  → green
 * - 50–79 → amber
 * - < 50  → red
 *
 * `unknown` is decided by callers (N/A sections), never derived here.
 */
export const SCORE_BAND_THRESHOLDS = {
  green: 80,
  amber: 50,
} as const;

export function bandForScore(score: number | null): ScoreBand {
  if (score === null || !Number.isFinite(score)) return 'unknown';
  if (score >= SCORE_BAND_THRESHOLDS.green) return 'green';
  if (score >= SCORE_BAND_THRESHOLDS.amber) return 'amber';
  return 'red';
}
