import { describe, expect, it } from 'vitest';

import { driftLine, factAgeDays, isExternalOrigin, listDriftedFacts } from '@/authoring/drift.js';
import type { SourceRow } from '@/authoring/stages/sources.js';

const NOW = new Date('2026-10-31T09:30:00.000Z');

function row(id: string, date: string, origin = 'https://docs.example.test/api'): SourceRow {
  return { id, fact: `fact ${id}`, origin, date, verified: 'yes', line: 1 };
}

describe('fact drift', () => {
  it('AC-36: 59 and 60 whole UTC days pass, 61 is older than 60', () => {
    const rows = [row('S-1', '2026-09-02'), row('S-2', '2026-09-01'), row('S-3', '2026-08-31')];
    expect(rows.map((entry) => factAgeDays(entry.date, NOW))).toEqual([59, 60, 61]);
    const drifted = listDriftedFacts(rows, NOW, 60);
    expect(drifted.map((fact) => fact.id)).toEqual(['S-3']);
    expect(driftLine(drifted[0]!, 60)).toBe(
      'S-3 "fact S-3" (https://docs.example.test/api) was verified 61 days ago, older than 60. Re-verify it.',
    );
  });

  it('only judges externally verified facts and flags an undated one', () => {
    expect(isExternalOrigin('app/Models/Invoice.php:41')).toBe(false);
    expect(isExternalOrigin('web: vendor docs')).toBe(true);
    const drifted = listDriftedFacts(
      [row('S-1', '2020-01-01', 'app/Models/Invoice.php:41'), row('S-2', 'unknown')],
      NOW,
      60,
    );
    expect(drifted.map((fact) => fact.id)).toEqual(['S-2']);
    expect(driftLine(drifted[0]!, 60)).toContain('has no verification date');
  });
});
