import { describe, expect, it } from 'vitest';

import { preCodeStagesRecorded } from '@/stage-evidence/live-writer.js';
import { PRE_CODE_STAGES, requiredPreCodeStages } from '@/stage-evidence/stages.js';
import { type StageLane } from '@/stage-evidence/types.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

describe('requiredPreCodeStages — the shared lane-aware pre-code set', () => {
  it('fast lane requires planning only (specification relaxed)', () => {
    expect(requiredPreCodeStages('fast')).toEqual(['planning']);
    expect(requiredPreCodeStages('fast')).not.toContain('specification');
  });

  it('graduated, full, and a null/unknown lane require all pre-code stages', () => {
    const all = [...PRE_CODE_STAGES];
    expect(requiredPreCodeStages('graduated')).toEqual(all);
    expect(requiredPreCodeStages('full')).toEqual(all);
    expect(requiredPreCodeStages(null)).toEqual(all);
    for (const lane of ['graduated', 'full', null] as const) {
      expect(requiredPreCodeStages(lane)).toContain('specification');
    }
  });

  it('returns a fresh array (callers may not mutate PRE_CODE_STAGES through it)', () => {
    const a = requiredPreCodeStages('full');
    a.pop();
    expect(requiredPreCodeStages('full')).toEqual([...PRE_CODE_STAGES]);
  });
});

describe('gate/writer agreement via the shared helper', () => {
  const startRows = (...stages: string[]): SessionLedgerRow[] =>
    stages.map((stage) => ({ kind: 'stage_start', stage }) as unknown as SessionLedgerRow);

  const LANES: StageLane[] = ['fast', 'graduated', 'full', null];

  it('planning-only is sufficient on fast, insufficient on every other lane', () => {
    const rows = startRows('planning');
    for (const lane of LANES) {
      const expected = requiredPreCodeStages(lane).every((s) => s === 'planning');
      expect(preCodeStagesRecorded(rows, lane)).toBe(expected);
    }
    expect(preCodeStagesRecorded(rows, 'fast')).toBe(true);
    expect(preCodeStagesRecorded(rows, 'graduated')).toBe(false);
    expect(preCodeStagesRecorded(rows, 'full')).toBe(false);
    expect(preCodeStagesRecorded(rows, null)).toBe(false);
  });

  it('planning + specification satisfies every lane', () => {
    const rows = startRows('planning', 'specification');
    for (const lane of LANES) {
      expect(preCodeStagesRecorded(rows, lane)).toBe(true);
    }
  });
});
