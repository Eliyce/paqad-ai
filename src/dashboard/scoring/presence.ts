export interface PresenceCounts {
  expected: number;
  present: number;
  stale?: number;
}

export interface PresenceOptions {
  presenceWeight?: number;
  freshnessWeight?: number;
}

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
