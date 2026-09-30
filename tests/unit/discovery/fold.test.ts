import { describe, expect, it } from 'vitest';

import { foldDiscoveryRun } from '@/discovery/fold.js';
import { DISCOVERY_STAGE_ORDER } from '@/discovery/stages.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

function row(
  kind: string,
  stage: string,
  ts: string,
  extra: Record<string, unknown> = {},
): SessionLedgerRow {
  return {
    schema_version: 1,
    doc_type: 'paqad.discovery-evidence',
    session_id: 's',
    ts,
    content_hash: 'x',
    kind,
    stage,
    ...extra,
  };
}

/** A start+end (with artifact) pair for a stage at the given clock minute. */
function completePair(stage: string, minute: number): SessionLedgerRow[] {
  const t = (m: number) => `2026-09-30T10:${String(m).padStart(2, '0')}:00.000Z`;
  return [
    row('stage_start', stage, t(minute)),
    row('stage_end', stage, t(minute + 1), { artifact_digest: `dig-${stage}` }),
  ];
}

describe('discovery fold', () => {
  it('cannot-verify with no rows', () => {
    const folded = foldDiscoveryRun([]);
    expect(folded.verdict).toBe('cannot-verify');
    expect(folded.missing).toEqual([...DISCOVERY_STAGE_ORDER]);
  });

  it('complete when all six stages have start+end+artifact in order', () => {
    const rows = DISCOVERY_STAGE_ORDER.flatMap((stage, i) => completePair(stage, i * 5));
    const folded = foldDiscoveryRun(rows);
    expect(folded.verdict).toBe('complete');
    expect(folded.missing).toEqual([]);
    expect(folded.orderingViolations).toEqual([]);
    expect(folded.stages.every((s) => s.complete)).toBe(true);
  });

  it('incomplete when a stage ended without a real artifact', () => {
    const rows = [
      row('stage_start', 'understand', '2026-09-30T10:00:00.000Z'),
      row('stage_end', 'understand', '2026-09-30T10:01:00.000Z'), // no artifact_digest
    ];
    const folded = foldDiscoveryRun(rows);
    expect(folded.verdict).toBe('incomplete');
    expect(folded.stages[0]!.started).toBe(true);
    expect(folded.stages[0]!.ended).toBe(true);
    expect(folded.stages[0]!.complete).toBe(false);
    expect(folded.missing).toContain('understand');
  });

  it('flags an ordering violation when a later stage starts before an earlier stage ends', () => {
    const rows = [
      row('stage_start', 'understand', '2026-09-30T10:00:00.000Z'),
      // investigate starts before understand ends
      row('stage_start', 'investigate', '2026-09-30T10:00:30.000Z'),
      row('stage_end', 'understand', '2026-09-30T10:05:00.000Z', { artifact_digest: 'd' }),
      row('stage_end', 'investigate', '2026-09-30T10:06:00.000Z', { artifact_digest: 'd' }),
    ];
    const folded = foldDiscoveryRun(rows);
    expect(folded.orderingViolations).toContainEqual({
      earlier: 'understand',
      later: 'investigate',
    });
    expect(folded.verdict).toBe('incomplete');
  });

  it('ignores foreign (feature-dev) stage rows', () => {
    const rows = [row('stage_start', 'development', '2026-09-30T10:00:00.000Z')];
    const folded = foldDiscoveryRun(rows);
    expect(folded.stages.every((s) => !s.started)).toBe(true);
  });

  it('reads recorded_at when a row carries no ts', () => {
    const r: SessionLedgerRow = {
      schema_version: 1,
      doc_type: 'paqad.discovery-evidence',
      session_id: 's',
      ts: undefined as unknown as string,
      recorded_at: '2026-09-30T10:00:00.000Z',
      content_hash: 'x',
      kind: 'stage_start',
      stage: 'understand',
    };
    const folded = foldDiscoveryRun([r]);
    expect(folded.stages[0]!.startedAt).toBe('2026-09-30T10:00:00.000Z');
  });
});
