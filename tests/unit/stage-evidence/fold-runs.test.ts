import { describe, expect, it } from 'vitest';

import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const identity = { sessionId: 's', changeKey: 'k', promptOrdinal: 0 };

function row(kind: string, at: string): SessionLedgerRow {
  return {
    doc_type: 'paqad.stage-evidence',
    session_id: 's',
    content_hash: 'h',
    kind,
    stage: 'development',
    recorded_at: `2026-11-11T${at}:00.000Z`,
  } as never;
}

function build(rows: SessionLedgerRow[]) {
  return foldRowsWithKey(rows, identity).stages.find((stage) => stage.stage === 'development')!;
}

describe('AC-8: the fold keeps every run of a stage', () => {
  it('keeps the first start, the last end and the run count beside the latest run', () => {
    const stage = build([
      row('stage_start', '08:13'),
      row('stage_end', '09:00'),
      row('stage_start', '10:00'),
      row('stage_end', '11:00'),
      row('stage_start', '12:00'),
      row('stage_end', '13:00'),
      row('stage_start', '13:10'),
      row('stage_end', '14:00'),
      row('stage_start', '15:00'),
      row('stage_end', '16:13'),
    ]);
    expect(stage.runs).toBe(5);
    expect(stage.first_started_at).toBe('2026-11-11T08:13:00.000Z');
    expect(stage.last_ended_at).toBe('2026-11-11T16:13:00.000Z');
    expect(stage.started_at).toBe('2026-11-11T15:00:00.000Z');
    expect(stage.ended_at).toBe('2026-11-11T16:13:00.000Z');
  });

  it('a stage that ran once counts one run, and an unstarted stage none', () => {
    const once = build([row('stage_start', '08:13'), row('stage_end', '09:00')]);
    expect(once.runs).toBe(1);
    expect(once.first_started_at).toBe(once.started_at);
    expect(build([]).runs).toBe(0);
    expect(build([]).first_started_at).toBeNull();
  });
});
