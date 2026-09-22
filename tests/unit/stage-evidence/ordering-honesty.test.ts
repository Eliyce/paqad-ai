// Ordering honesty in the stage-evidence fold and gate (issue #573).
//
// Two defects found while doing the #573 RCA, both in the same gate, both of the same
// shape: the framework computed the right signal and then threw it away on the way to
// the human.
//
//   B. `computeVerdict` returns 'incomplete' for a missing stage OR an ordering
//      violation, but the gate message only ever printed the missing list. A real change
//      was blocked with the literal, unactionable text `missing stage(s): []`.
//   C. `computeOrderingViolations` only compared two DIFFERENT stages and skipped the
//      completion-anchored one, so a stage whose end row predates its own start row
//      folded to 'complete'. `duration_unreliable` caught it, but that flag only ever
//      reached the receipt renderer, never the verdict.

import { describe, expect, it } from 'vitest';

import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  describeOrderingViolations,
  stageEvidenceGate,
} from '@/verification/repository/run-repository-verification.js';
import type { VerifyResult } from '@/stage-evidence/verify.js';

const SESSION = 'ordering-honesty-session';

function row(partial: Record<string, unknown>): SessionLedgerRow {
  return {
    schema_version: 1,
    doc_type: 'paqad.stage-evidence',
    session_id: SESSION,
    conversation_ordinal: 1,
    adapter: 'claude-code',
    content_hash: 'hash',
    ...partial,
  } as SessionLedgerRow;
}

/** A start+end pair for `stage`, with an artifact so a thinking stage can read complete. */
function stagePair(stage: string, startedAt: string, endedAt: string): SessionLedgerRow[] {
  return [
    row({ kind: 'stage_start', stage, event_status: 'started', ts: startedAt }),
    row({
      kind: 'stage_end',
      stage,
      event_status: 'completed',
      ts: endedAt,
      artifact_digest: `sha256-${stage}`,
    }),
  ];
}

/** Every mandatory stage recorded cleanly and in order. */
function healthyRows(): SessionLedgerRow[] {
  return [
    row({ kind: 'open', ts: '2026-01-01T10:00:00.000Z' }),
    ...stagePair('planning', '2026-01-01T10:01:00.000Z', '2026-01-01T10:02:00.000Z'),
    ...stagePair('specification', '2026-01-01T10:03:00.000Z', '2026-01-01T10:04:00.000Z'),
    ...stagePair('development', '2026-01-01T10:05:00.000Z', '2026-01-01T10:06:00.000Z'),
    ...stagePair('review', '2026-01-01T10:07:00.000Z', '2026-01-01T10:08:00.000Z'),
    ...stagePair('checks', '2026-01-01T10:09:00.000Z', '2026-01-01T10:10:00.000Z'),
    ...stagePair('documentation_sync', '2026-01-01T10:11:00.000Z', '2026-01-01T10:12:00.000Z'),
  ];
}

function fold(rows: SessionLedgerRow[]) {
  return foldRowsWithKey(rows, { sessionId: SESSION, changeKey: 'change', promptOrdinal: 0 });
}

describe('a stage inverted against itself (issue #573, defect C)', () => {
  it('folds a clean run to complete, so the fixture is a real control', () => {
    const folded = fold(healthyRows());

    expect(folded.completeness.missing_stages).toEqual([]);
    expect(folded.completeness.ordering_violations).toEqual([]);
    expect(folded.completeness.verdict).toBe('complete');
  });

  it('reports an ordering violation when a stage ends before it starts', () => {
    // `specification` end at 10:03 but start at 10:04 — the exact signature seen in a real
    // bundle, where the CLI recorded the end and the marker parse back-filled the start.
    const rows = healthyRows().filter((r) => r.stage !== 'specification');
    rows.push(
      ...stagePair('specification', '2026-01-01T10:04:00.000Z', '2026-01-01T10:03:00.000Z'),
    );

    const folded = fold(rows);

    expect(folded.completeness.ordering_violations).toContainEqual({
      before: 'specification',
      after: 'specification',
    });
  });

  it('does not let that change read complete', () => {
    const rows = healthyRows().filter((r) => r.stage !== 'specification');
    rows.push(
      ...stagePair('specification', '2026-01-01T10:04:00.000Z', '2026-01-01T10:03:00.000Z'),
    );

    const folded = fold(rows);

    // Nothing is missing — every stage has a start and an end — so before #573 this read
    // `complete; missing=[]` and shipped.
    expect(folded.completeness.missing_stages).toEqual([]);
    expect(folded.completeness.verdict).not.toBe('complete');
  });

  it('catches it on review too, which the pair loop skips as completion-anchored', () => {
    const rows = healthyRows().filter((r) => r.stage !== 'review');
    rows.push(...stagePair('review', '2026-01-01T10:08:00.000Z', '2026-01-01T10:07:00.000Z'));

    const folded = fold(rows);

    expect(folded.completeness.ordering_violations).toContainEqual({
      before: 'review',
      after: 'review',
    });
    expect(folded.completeness.verdict).not.toBe('complete');
  });

  it('still reports a cross-stage violation as the ordered pair it is', () => {
    // documentation_sync starts while checks is still open — the other real shape.
    const rows = healthyRows().filter((r) => r.stage !== 'documentation_sync');
    rows.push(
      ...stagePair('documentation_sync', '2026-01-01T10:09:30.000Z', '2026-01-01T10:12:00.000Z'),
    );

    const folded = fold(rows);

    expect(folded.completeness.ordering_violations).toContainEqual({
      before: 'checks',
      after: 'documentation_sync',
    });
  });
});

describe('the gate names what actually blocked (issue #573, defect B)', () => {
  function verifyResult(partial: Partial<VerifyResult>): VerifyResult {
    return {
      verdict: 'incomplete',
      ok: false,
      blocked: false,
      live_marked: true,
      missing_stages: [],
      ordering_violations: [],
      redo_attempts: 0,
      change_key: 'change',
      ...partial,
    } as VerifyResult;
  }

  it('names the violated pair instead of printing an empty missing list', () => {
    const gate = stageEvidenceGate(
      verifyResult({ ordering_violations: [{ before: 'checks', after: 'documentation_sync' }] }),
      'hook-completion',
      0,
      'strict',
    );

    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('checks -> documentation_sync');
    expect(gate?.detail).not.toContain('missing stage(s): []');
  });

  it('still names the missing stages when stages really are missing', () => {
    const gate = stageEvidenceGate(
      verifyResult({ missing_stages: ['review'] }),
      'hook-completion',
      0,
      'strict',
    );

    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('missing stage(s): [review]');
  });

  it('prefers the missing list when a change is both incomplete and out of order', () => {
    const gate = stageEvidenceGate(
      verifyResult({
        missing_stages: ['checks'],
        ordering_violations: [{ before: 'planning', after: 'development' }],
      }),
      'hook-completion',
      0,
      'strict',
    );

    expect(gate?.detail).toContain('missing stage(s): [checks]');
  });

  it('gives an ordering failure remediation that fits the actual problem', () => {
    const gate = stageEvidenceGate(
      verifyResult({ ordering_violations: [{ before: 'checks', after: 'documentation_sync' }] }),
      'hook-completion',
      0,
      'strict',
    );

    expect(gate?.remediation).toContain('ends before the next begins');
  });
});

describe('describeOrderingViolations', () => {
  it('renders a cross-stage violation as an arrow pair', () => {
    expect(describeOrderingViolations([{ before: 'checks', after: 'documentation_sync' }])).toBe(
      'checks -> documentation_sync',
    );
  });

  it('renders a self-inverted stage in plain words', () => {
    expect(describeOrderingViolations([{ before: 'review', after: 'review' }])).toBe(
      'review ended before it started',
    );
  });

  it('joins several violations', () => {
    expect(
      describeOrderingViolations([
        { before: 'review', after: 'review' },
        { before: 'checks', after: 'documentation_sync' },
      ]),
    ).toBe('review ended before it started; checks -> documentation_sync');
  });

  it('renders an empty list as an empty string', () => {
    expect(describeOrderingViolations([])).toBe('');
  });
});
