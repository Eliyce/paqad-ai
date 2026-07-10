import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { foldRowsWithKey, openStageEvidence } from '@/stage-evidence/index.js';
import { foldFeature } from '@/feature-evidence/stage-ledger.js';
import { writePendingLane } from '@/stage-evidence/pending-lane.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const SESSION = 'sess-fold-lane';
const ADAPTER = 'claude-code';

/** Minimal hand-built row envelope for fold unit coverage. */
function row(fields: Partial<SessionLedgerRow>): SessionLedgerRow {
  return {
    schema_version: 1,
    doc_type: 'paqad.stage-evidence',
    session_id: SESSION,
    ts: '2026-07-09T00:00:00.000Z',
    content_hash: 'x',
    ...fields,
  } as SessionLedgerRow;
}

/** Fold hand-built rows under a synthetic feature key. */
function foldRows(rows: SessionLedgerRow[]) {
  return foldRowsWithKey(rows, { sessionId: SESSION, changeKey: 'feat', promptOrdinal: 0 });
}

describe('fold lane read (#324)', () => {
  it('reads the lane from the open row', () => {
    const folded = foldRows([row({ kind: 'open', lane: 'fast' })]);
    expect(folded.lane).toBe('fast');
  });

  it('is null when there is no open row', () => {
    const folded = foldRows([row({ kind: 'stage_start', stage: 'planning' })]);
    expect(folded.lane).toBeNull();
  });

  it('is null for an unrecognised lane value on the open row', () => {
    const folded = foldRows([row({ kind: 'open', lane: 'sideways' as never })]);
    expect(folded.lane).toBeNull();
  });
});

describe('openStageEvidence lane recording (#324)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-open-lane-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stamps the stashed pending lane on the open row when no explicit lane is given', () => {
    writePendingLane(root, SESSION, 'graduated');
    const { dirName } = openStageEvidence(root, { sessionId: SESSION, adapter: ADAPTER });
    expect(foldFeature(root, SESSION, dirName).lane).toBe('graduated');
  });

  it('records null when there is no stashed lane', () => {
    const { dirName } = openStageEvidence(root, { sessionId: SESSION, adapter: ADAPTER });
    expect(foldFeature(root, SESSION, dirName).lane).toBeNull();
  });

  it('lets an explicit ctx.lane win over the stash', () => {
    writePendingLane(root, SESSION, 'fast');
    const { dirName } = openStageEvidence(root, {
      sessionId: SESSION,
      adapter: ADAPTER,
      lane: 'full',
    });
    expect(foldFeature(root, SESSION, dirName).lane).toBe('full');
  });
});
