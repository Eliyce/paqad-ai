import type { ScoreBand } from '../types.js';

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
