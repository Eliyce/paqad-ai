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

  it('AC-5: ends a live-mark stage the writer left open (turn-boundary end) and writes no inferred row', () => {
    const sessionId = 'ses_dangling';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    // The PreToolUse writer started development but the turn ended before any later
    // stage closed it — a dangling live-mark stage_start with no matching end.
    startStage(root, 'development', { sessionId, ordinal, adapter: 'claude-code' });

    finalizeStageEvidence(root, { adapter: ADAPTER, sessionId, changedFilesCount: 1 });

    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    const devEnd = rows.find((row) => row.kind === 'stage_end' && row.stage === 'development');
    expect(devEnd, 'the dangling stage should be closed at the turn boundary').toBeDefined();
    expect(devEnd?.evidence_source).toBe('live-mark');
    // Real live rows exist → the inferred-git backstop must NOT also fire (AC-4).
    expect(rows.some((row) => row.evidence_source === 'inferred-git')).toBe(false);
  });

  it('#270: anchors a review the agent left open at the completion seam → complete', () => {
    const sessionId = 'ses_late_review';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    // Build order: the live writer stamps checks/docs during the build…
    for (const stage of [
      'planning',
      'specification',
      'development',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, ordinal, adapter: 'claude-code' });
    }
    // …then the agent emits `paqad:stage review start` while reviewing the finished
    // diff, but the turn ends before the `end` marker. The completion seam must
    // anchor (close) it, not reject it — a review after checks/docs is legitimate.
    startStage(root, 'review', { sessionId, ordinal, adapter: 'claude-code' });

    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });

    expect(result?.verdict).toBe('complete');
    expect(result?.ok).toBe(true);
    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    const reviewEnd = rows.find((row) => row.kind === 'stage_end' && row.stage === 'review');
    expect(reviewEnd, 'finalize should anchor the open review at completion').toBeDefined();
    expect(reviewEnd?.evidence_source).toBe('live-mark');
  });

  it('#310: a documentation-only change is a no-op (isFeatureDevChange=false) — code stages do not apply', () => {
    const sessionId = 'ses_docs_only';
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 2,
      isFeatureDevChange: false,
    });
    // No feature being built → no gate, no inferred backstop record.
    expect(result).toBeNull();
    expect(readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId)).toEqual([]);
  });

  it('#310: backfills an inferred development row when planning+spec were recorded but no development mark exists', () => {
    const sessionId = 'ses_backfill';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    // planning + specification recorded (markers/CLI); the sole same-turn edit had its
    // development mark deferred by the live writer, so no development row exists.
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, ordinal, adapter: 'claude-code' });
    }
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
      subjectDigest: 'sha256-abc',
      isFeatureDevChange: true,
    });
    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    const dev = rows.find((r) => r.stage === 'development' && r.evidence_source === 'inferred-git');
    expect(dev, 'a real code change must show a development stage').toBeDefined();
    expect(dev?.subject_digest).toBe('sha256-abc');
    // development is now present → it is no longer reported missing (only the later
    // unrecorded stages are).
    expect(result?.missing_stages).not.toContain('development');
  });

  it('#310: does NOT backfill development when a development row already exists (even an orphan end)', () => {
    // hasDevelopment is satisfied by a development row of EITHER kind. Here the only
    // development row is an orphan stage_end (no matching start) — the backfill must
    // still see development as present and add no inferred-git row, so a real change is
    // never double-marked. Exercises the stage_end arm of the presence check.
    const sessionId = 'ses_backfill_orphan_end';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, ordinal, adapter: 'claude-code' });
    }
    // An END with no START — the only development row present.
    endStage(root, 'development', {}, { sessionId, ordinal, adapter: 'claude-code' });

    finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
      subjectDigest: 'sha256-orphan',
      isFeatureDevChange: true,
    });

    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    // No inferred-git development row was added — the existing end already counts.
    expect(
      rows.some((r) => r.stage === 'development' && r.evidence_source === 'inferred-git'),
    ).toBe(false);
  });

  it('#310: does NOT infer a development row for a clean-tree change (no diff to anchor to)', () => {
    const sessionId = 'ses_backfill_clean';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, ordinal, adapter: 'claude-code' });
    }
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 0,
      isFeatureDevChange: true,
    });
    // No working-tree delta → nothing honest to infer development from.
    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    expect(rows.some((r) => r.evidence_source === 'inferred-git')).toBe(false);
    expect(result?.missing_stages).toContain('development');
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
