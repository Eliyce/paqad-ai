// The fold reads a row's time from the envelope's `recorded_at` (issue #581, S5).
//
// A bundle row written since #581 carries `recorded_at` instead of `ts`; a bundle written
// before carries `ts`. A change that spans the upgrade holds both in one file, so the fold
// must time a stage from either field, and a start in one shape with an end in the other.

import { describe, expect, it } from 'vitest';

import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const identity = { sessionId: 's', changeKey: 'k', promptOrdinal: 0 };

function row(fields: Record<string, unknown>): SessionLedgerRow {
  return {
    doc_type: 'paqad.stage-evidence',
    session_id: 's',
    content_hash: 'h',
    ...fields,
  } as never;
}

function planning(rows: SessionLedgerRow[]) {
  return foldRowsWithKey(rows, identity).stages.find((stage) => stage.stage === 'planning')!;
}

describe('fold timing across row shapes', () => {
  it('times a stage from recorded_at on new rows', () => {
    const stage = planning([
      row({ kind: 'stage_start', stage: 'planning', recorded_at: '2026-09-01T10:00:00.000Z' }),
      row({ kind: 'stage_end', stage: 'planning', recorded_at: '2026-09-01T10:00:04.000Z' }),
    ]);
    expect(stage.started_at).toBe('2026-09-01T10:00:00.000Z');
    expect(stage.ended_at).toBe('2026-09-01T10:00:04.000Z');
    expect(stage.duration_ms).toBe(4000);
  });

  it('times a stage whose start is a legacy ts row and whose end is a new row (INV-8)', () => {
    const stage = planning([
      row({ kind: 'stage_start', stage: 'planning', ts: '2026-09-01T10:00:00.000Z' }),
      row({ kind: 'stage_end', stage: 'planning', recorded_at: '2026-09-01T10:00:02.000Z' }),
    ]);
    expect(stage.duration_ms).toBe(2000);
    expect(stage.duration_unreliable).toBe(false);
  });

  it('reads a row with neither time field as untimed rather than guessing', () => {
    const stage = planning([
      row({ kind: 'stage_start', stage: 'planning' }),
      row({ kind: 'stage_end', stage: 'planning' }),
    ]);
    expect(stage.started_at).toBeNull();
    expect(stage.ended_at).toBeNull();
    expect(stage.duration_ms).toBeNull();
  });
});
