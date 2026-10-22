import { describe, expect, it } from 'vitest';

import { augmentWithBundleArtifacts, foldRowsWithKey } from '@/stage-evidence/fold.js';
import { type StageLane } from '@/stage-evidence/types.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

let tick = 0;
function row(kind: string, stage?: string, extra: Record<string, unknown> = {}): SessionLedgerRow {
  tick += 1;
  return {
    kind,
    ...(stage ? { stage } : {}),
    recorded_at: new Date(1_000_000 + tick * 1000).toISOString(),
    ...extra,
  } as unknown as SessionLedgerRow;
}

function ran(stage: string): SessionLedgerRow[] {
  const end = stage === 'planning' ? { artifact_digest: 'sha256:plan' } : {};
  return [row('stage_start', stage), row('stage_end', stage, end)];
}

function fold(rows: SessionLedgerRow[], lane?: StageLane) {
  return foldRowsWithKey(rows, {
    sessionId: 's',
    changeKey: 'c',
    promptOrdinal: 0,
    ...(lane !== undefined ? { lane } : {}),
  });
}

const stateOf = (folded: ReturnType<typeof fold>, stage: string) =>
  folded.stages.find((entry) => entry.stage === stage)?.state;

describe('foldRowsWithKey — the lane decides which stages are required', () => {
  const fastRun = () => [
    row('open', undefined, { lane: 'fast' }),
    ...ran('planning'),
    ...ran('development'),
    ...ran('checks'),
  ];

  it('a fast change with planning, development and checks done is complete', () => {
    const folded = fold(fastRun());
    expect(folded.lane).toBe('fast');
    expect(folded.completeness.verdict).toBe('complete');
    expect(folded.completeness.missing_stages).toEqual([]);
    expect(folded.completeness.required_total).toBe(3);
    for (const stage of ['specification', 'review', 'documentation_sync']) {
      expect(stateOf(folded, stage), stage).toBe('not-applicable');
    }
  });

  it('a stage outside the lane that did run keeps its recorded state', () => {
    const folded = fold([...fastRun(), ...ran('documentation_sync')]);
    expect(stateOf(folded, 'documentation_sync')).toBe('complete');
    expect(folded.completeness.required_total).toBe(3);
  });

  it('the lane passed in wins over the open row', () => {
    const folded = fold(fastRun(), 'graduated');
    expect(folded.lane).toBe('graduated');
    expect(folded.completeness.missing_stages).toEqual([
      'specification',
      'review',
      'documentation_sync',
    ]);
  });

  it('an unknown lane fails safe to every mandatory stage', () => {
    const folded = fold([...ran('planning'), ...ran('development'), ...ran('checks')]);
    expect(folded.lane).toBeNull();
    expect(folded.completeness.required_total).toBe(6);
    expect(stateOf(folded, 'specification')).toBe('missing');
  });

  it('a missing spec file is not asked for on the fast lane', () => {
    const folded = augmentWithBundleArtifacts(fold(fastRun()), {
      plan: true,
      specification: false,
    });
    expect(folded.completeness.verdict).toBe('complete');
  });

  it('a missing spec file is still asked for on the graduated lane', () => {
    const folded = augmentWithBundleArtifacts(fold(fastRun(), 'graduated'), {
      plan: true,
      specification: false,
    });
    expect(folded.completeness.missing_stages).toContain('specification');
  });
});
