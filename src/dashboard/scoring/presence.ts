/**
 * Presence scoring — pure functions, no I/O.
 *
 * A section computes how many of its `expected` artifacts are `present`
 * (and optionally how many of those are `stale`). Phase-1 weighting:
 * 70% presence, 30% freshness of the present artifacts.
 */

export interface PresenceCounts {
  expected: number;
  present: number;
  /** Subset of `present` whose freshness score is < 100. Optional. */
  stale?: number;
}

export interface PresenceOptions {
  /** Weight given to "did the artifact exist at all". Default 0.7. */
  presenceWeight?: number;
  /** Weight given to "is the present artifact fresh". Default 0.3. */
  freshnessWeight?: number;
}

/**
 * Score a section from expected/present (+ optional stale) counts.
 *
 * - `expected === 0` returns 0 — callers should branch on N/A before
 *   calling this; we deliberately do not synthesise a band here.
 * - The freshness component only kicks in when `stale` is provided.
 */
export function scorePresence(counts: PresenceCounts, options: PresenceOptions = {}): number {
  const presenceWeight = options.presenceWeight ?? 0.7;
  const freshnessWeight = options.freshnessWeight ?? 0.3;
  const { expected, present, stale } = counts;

  if (expected <= 0) return 0;
  const presenceRatio = Math.min(1, Math.max(0, present / expected));

  if (stale === undefined) {
    return Math.round(presenceRatio * 100);
  }

  const freshPresent = Math.max(0, present - Math.max(0, stale));
  const freshnessRatio = present > 0 ? freshPresent / present : 0;
  const total = presenceRatio * presenceWeight + freshnessRatio * freshnessWeight;
  const normalised = total / (presenceWeight + freshnessWeight);
  return Math.round(Math.max(0, Math.min(1, normalised)) * 100);
}
