export const DEFAULT_FRESH_WINDOW_DAYS = 30;
export const DEFAULT_STALE_CLIFF_DAYS = 180;

export interface FreshnessOptions {
  freshWindowDays?: number;
  staleCliffDays?: number;
  now?: number;
}

const MS_PER_DAY = 86_400_000;

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

export function scoreFreshnessAverage(
  mtimes: ReadonlyArray<number | null | undefined>,
  options: FreshnessOptions = {},
): number {
  if (mtimes.length === 0) return 0;
  const total = mtimes.reduce<number>((sum, m) => sum + scoreFreshness(m, options), 0);
  return Math.round(total / mtimes.length);
}

export function ageInDays(
  mtimeMs: number | null | undefined,
  now: number = Date.now(),
): number | null {
  if (mtimeMs === null || mtimeMs === undefined || !Number.isFinite(mtimeMs)) return null;
  return Math.max(0, Math.floor((now - mtimeMs) / MS_PER_DAY));
}
