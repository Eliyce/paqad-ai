import { describe, expect, it } from 'vitest';

import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { runningStageOfOtherSession } from '@/stage-evidence/stage-agent-holds.js';

const T0 = Date.parse('2026-07-19T00:00:00.000Z');
const minutes = (n: number) => T0 + n * 60_000;

let seq = 0;
function row(sessionId: string, minute: number, fields: Record<string, unknown>): SessionLedgerRow {
  seq += 1;
  const at = new Date(minutes(minute)).toISOString();
  return {
    schema_version: 2,
    doc_type: 'paqad.stage-evidence',
    session_id: sessionId,
    ts: at,
    recorded_at: at,
    content_hash: `h-${seq}`,
    ...fields,
  };
}

const start = (sessionId: string, minute: number, stage: string) =>
  row(sessionId, minute, { kind: 'stage_start', stage, event_status: 'started' });
const end = (sessionId: string, minute: number, stage: string) =>
  row(sessionId, minute, { kind: 'stage_end', stage, event_status: 'completed' });

describe('runningStageOfOtherSession', () => {
  it('names an open stage whose session wrote a row in the last 30 minutes', () => {
    const rows = [row('ses_a', 0, { kind: 'open' }), start('ses_a', 0, 'development')];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(29))).toBe('development');
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(31))).toBeNull();
  });

  it('measures the age from the session newest row, not from the stage start', () => {
    const rows = [start('ses_a', 0, 'development'), row('ses_a', 40, { kind: 'open' })];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(60))).toBe('development');
  });

  it('ignores a stage the asking session started', () => {
    const rows = [start('ses_b', 0, 'development')];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(1))).toBeNull();
  });

  it('applies to every session when no session asks', () => {
    const rows = [start('ses_a', 0, 'checks')];
    expect(runningStageOfOtherSession(rows, null, minutes(1))).toBe('checks');
  });

  it('counts a stage ended by any writer as ended', () => {
    const rows = [start('ses_a', 0, 'development'), end('paqad-backstop', 1, 'development')];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(2))).toBeNull();
  });

  it('names a live stage agent of another session whatever its age', () => {
    const rows = [
      row('ses_a', 0, { kind: 'stage-agent', event_status: 'started', stage: 'review' }),
    ];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(600))).toBe('review');
    expect(runningStageOfOtherSession(rows, 'ses_a', minutes(600))).toBeNull();
  });

  it('ignores a row whose time cannot be read when it ages a session', () => {
    const unreadable = {
      ...start('ses_a', 0, 'development'),
      recorded_at: 'not a time',
      ts: 'not a time',
    };
    expect(runningStageOfOtherSession([unreadable], 'ses_b', minutes(1))).toBeNull();
    const rows = [unreadable, row('ses_a', 0, { kind: 'open' })];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(1))).toBe('development');
  });

  it('ignores a stage row that names no stage', () => {
    const nameless = row('ses_a', 0, { kind: 'stage_start', event_status: 'started' });
    expect(runningStageOfOtherSession([nameless], 'ses_b', minutes(1))).toBeNull();
    const rows = [nameless, start('ses_a', 0, 'checks')];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(1))).toBe('checks');
  });

  it('is null for a quiet bundle', () => {
    const rows = [start('ses_a', 0, 'planning'), end('ses_a', 1, 'planning')];
    expect(runningStageOfOtherSession(rows, 'ses_b', minutes(2))).toBeNull();
  });
});
