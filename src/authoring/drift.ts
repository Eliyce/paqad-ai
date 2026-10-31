import type { SourceRow } from './stages/sources.js';

export const DAY_MS = 86_400_000;

export interface DriftedFact {
  id: string;
  fact: string;
  origin: string;
  date: string;
  age_days: number;
}

export function isExternalOrigin(origin: string): boolean {
  return /^https?:\/\//iu.test(origin.trim()) || /^web\b/iu.test(origin.trim());
}

function utcDay(value: Date): number {
  return Math.floor(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / DAY_MS,
  );
}

export function factAgeDays(date: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date.trim());
  if (!match) return null;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
  return utcDay(now) - day;
}

export function listDriftedFacts(
  rows: readonly SourceRow[],
  now: Date,
  maxAgeDays: number,
): DriftedFact[] {
  const drifted: DriftedFact[] = [];
  for (const row of rows) {
    if (!isExternalOrigin(row.origin)) continue;
    const age = factAgeDays(row.date, now);
    if (age === null || age > maxAgeDays) {
      drifted.push({
        id: row.id,
        fact: row.fact,
        origin: row.origin,
        date: row.date,
        age_days: age ?? Number.POSITIVE_INFINITY,
      });
    }
  }
  return drifted;
}

export function driftLine(fact: DriftedFact, maxAgeDays: number): string {
  return Number.isFinite(fact.age_days)
    ? `${fact.id} "${fact.fact}" (${fact.origin}) was verified ${fact.age_days} days ago, older than ${maxAgeDays}. Re-verify it.`
    : `${fact.id} "${fact.fact}" (${fact.origin}) has no verification date. Re-verify it and add the date.`;
}
