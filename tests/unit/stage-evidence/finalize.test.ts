import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  endStage,
  finalizeStageEvidence,
  openStageEvidence,
  STAGE_EVIDENCE_DOC_TYPE,
  startStage,
} from '@/stage-evidence/index.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';

const ADAPTER = 'backstop';

describe('finalizeStageEvidence (automatic end-gate, #247)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stage-fin-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is a pure no-op when there is no open change and no code diff', () => {
    const result = finalizeStageEvidence(root, { adapter: ADAPTER, changedFilesCount: 0 });
    expect(result).toBeNull();
    expect(readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, 'ses_none')).toEqual([]);
  });

  it('verifies the open change the agent recorded', () => {
    const sessionId = 'ses_fin';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of [
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, ordinal, adapter: 'claude-code' });
    }
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(result?.ok).toBe(true);
    expect(result?.verdict).toBe('complete');
  });

  it('writes a single inferred-git backstop record for an untracked code diff', () => {
    const sessionId = 'ses_inferred';
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 3,
      subjectDigest: 'deadbeef',
    });
    // No stages were tracked → honestly incomplete, never a false complete.
    expect(result?.ok).toBe(false);
    expect(result?.verdict).toBe('incomplete');
    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    const inferred = rows.find((row) => row.evidence_source === 'inferred-git');
    expect(inferred).toBeDefined();
    expect(inferred?.subject_digest).toBe('deadbeef');
  });

  it('swallows errors and returns null (best-effort, never breaks verification)', () => {
    // A projectRoot that is a FILE makes the ledger mkdir fail — finalize must
    // catch it and return null rather than throw into the verification backstop.
    const filePath = join(root, 'not-a-dir');
    writeFileSync(filePath, 'x');
    const result = finalizeStageEvidence(filePath, {
      adapter: ADAPTER,
      sessionId: 'ses_err',
      changedFilesCount: 1,
    });
    expect(result).toBeNull();
  });

  it('does not re-verify a change that already has a verify row (verify-once)', () => {
    const sessionId = 'ses_once';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId, ordinal, adapter: 'claude-code' });
    endStage(root, 'planning', {}, { sessionId, ordinal, adapter: 'claude-code' });

    const first = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(first).not.toBeNull();
    const verifyCountAfterFirst = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId).filter(
      (row) => row.kind === 'verify',
    ).length;

    const second = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(second).toBeNull(); // verify-once guard
    const verifyCountAfterSecond = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId).filter(
      (row) => row.kind === 'verify',
    ).length;
    expect(verifyCountAfterSecond).toBe(verifyCountAfterFirst);
  });
});
