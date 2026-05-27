/**
 * Freshness scoring — pure functions, no I/O.
 *
 * Phase-1 rubric (issue #64): existence + freshness only. A file
 * modified ≤ 30 days ago scores 100; older entries decay linearly to
 * 0 at the cliff. Missing files score 0 here — presence is scored
 * separately by `scorePresence`.
 */

export const DEFAULT_FRESH_WINDOW_DAYS = 30;
export const DEFAULT_STALE_CLIFF_DAYS = 180;

export interface FreshnessOptions {
  /** Files modified within this window are fully fresh. Default 30 days. */
  freshWindowDays?: number;
  /** Files older than this are fully stale. Default 180 days. */
  staleCliffDays?: number;
  /**
   * Reference timestamp used to compute age (defaults to `Date.now()`).
   * Tests pass a fixed value to keep snapshots deterministic.
   */
  now?: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Score a single timestamp on a 0..100 freshness scale.
 *
 * - `null` / not-a-number → 0 (treated as missing).
 * - Within the fresh window → 100.
 * - Past the stale cliff → 0.
 * - Between → linear interpolation.
 */
export function scoreFreshness(
  mtimeMs: number | null | undefined,
  options: FreshnessOptions = {},
): number {
  if (mtimeMs === null || mtimeMs === undefined || !Number.isFinite(mtimeMs)) {
    return 0;
  }
  const freshWindowDays = options.freshWindowDays ?? DEFAULT_FRESH_WINDOW_DAYS;
  const staleCliffDays = options.staleCliffDays ?? DEFAULT_STALE_CLIFF_DAYS;
  const now = options.now ?? Date.now();
  const ageDays = Math.max(0, (now - mtimeMs) / MS_PER_DAY);
  if (ageDays <= freshWindowDays) return 100;
  if (ageDays >= staleCliffDays) return 0;
  const range = staleCliffDays - freshWindowDays;
  const remaining = staleCliffDays - ageDays;
  return Math.max(0, Math.min(100, Math.round((remaining / range) * 100)));
}

/**
 * Score a collection of timestamps as the arithmetic mean of their
 * individual freshness scores. Missing/empty input returns 0.
 */
export function scoreFreshnessAverage(
  mtimes: ReadonlyArray<number | null | undefined>,
  options: FreshnessOptions = {},
): number {
  if (mtimes.length === 0) return 0;
  const total = mtimes.reduce<number>((sum, m) => sum + scoreFreshness(m, options), 0);
  return Math.round(total / mtimes.length);
}

/** Days since `mtimeMs`. Useful for compact metrics like "stale 42d". */
export function ageInDays(
  mtimeMs: number | null | undefined,
  now: number = Date.now(),
): number | null {
  if (mtimeMs === null || mtimeMs === undefined || !Number.isFinite(mtimeMs)) return null;
  return Math.max(0, Math.floor((now - mtimeMs) / MS_PER_DAY));
}
