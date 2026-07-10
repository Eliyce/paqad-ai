import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdirSync } from 'node:fs';

import {
  endStage,
  finalizeStageEvidence,
  isArtifactBearingStage,
  openStageEvidence,
  startStage,
  type EndStageInput,
} from '@/stage-evidence/index.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

const ADAPTER = 'backstop';

/** End-stage args satisfying the #320 artifact requirement for a thinking stage. */
function provenEndArgs(root: string, stage: string): EndStageInput {
  if (!isArtifactBearingStage(stage)) return {};
  const rel = `.paqad/artifacts/${stage}.md`;
  mkdirSync(join(root, '.paqad', 'artifacts'), { recursive: true });
  writeFileSync(join(root, rel), `# ${stage} artifact\n`);
  return { artifactPaths: [rel] };
}

/** Read the rows for a session's active feature, or [] when none is active. */
function activeRows(root: string, sessionId: string) {
  const dir = currentFeature(root, sessionId);
  return dir ? readFeatureStageUnit(root, dir) : [];
}

describe('finalizeStageEvidence (automatic end-gate, #247)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stage-fin-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is a pure no-op when there is no open change and no code diff', () => {
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId: 'ses_none',
      changedFilesCount: 0,
    });
    expect(result).toBeNull();
    expect(currentFeature(root, 'ses_none')).toBeNull();
  });

  it('verifies the open change the agent recorded', () => {
    const sessionId = 'ses_fin';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of [
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(root, stage), {
        sessionId,
        dirName,
        adapter: 'claude-code',
      });
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
    const rows = activeRows(root, sessionId);
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
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    // The PreToolUse writer started development but the turn ended before any later
    // stage closed it — a dangling live-mark stage_start with no matching end.
    startStage(root, 'development', { sessionId, dirName, adapter: 'claude-code' });

    finalizeStageEvidence(root, { adapter: ADAPTER, sessionId, changedFilesCount: 1 });

    const rows = activeRows(root, sessionId);
    const devEnd = rows.find((row) => row.kind === 'stage_end' && row.stage === 'development');
    expect(devEnd, 'the dangling stage should be closed at the turn boundary').toBeDefined();
    expect(devEnd?.evidence_source).toBe('live-mark');
    // Real live rows exist → the inferred-git backstop must NOT also fire (AC-4).
    expect(rows.some((row) => row.evidence_source === 'inferred-git')).toBe(false);
  });

  it('#270/#320: anchors a review the agent left open, but an artifact-less review is inconclusive', () => {
    const sessionId = 'ses_late_review';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    // Build order: the live writer stamps checks/docs during the build…
    for (const stage of [
      'planning',
      'specification',
      'development',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(root, stage), {
        sessionId,
        dirName,
        adapter: 'claude-code',
      });
    }
    // …then the agent emits `paqad:stage review start` while reviewing the finished
    // diff, but the turn ends before the `end` marker. The completion seam still
    // anchors (closes) it — #270 — but with no findings artifact the review proves no
    // work, so #320 folds it inconclusive → the change is honestly incomplete, never a
    // false complete. To pass, the agent must end review with a real findings file.
    startStage(root, 'review', { sessionId, dirName, adapter: 'claude-code' });

    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });

    expect(result?.verdict).toBe('incomplete');
    expect(result?.ok).toBe(false);
    expect(result?.missing_stages).toContain('review');
    const rows = readFeatureStageUnit(root, dirName);
    const reviewEnd = rows.find((row) => row.kind === 'stage_end' && row.stage === 'review');
    expect(
      reviewEnd,
      'finalize should still anchor the open review at completion (#270)',
    ).toBeDefined();
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
    expect(currentFeature(root, sessionId)).toBeNull();
  });

  it('#310: backfills an inferred development row when planning+spec were recorded but no development mark exists', () => {
    const sessionId = 'ses_backfill';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    // planning + specification recorded (markers/CLI); the sole same-turn edit had its
    // development mark deferred by the live writer, so no development row exists.
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, dirName, adapter: 'claude-code' });
    }
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
      subjectDigest: 'sha256-abc',
      isFeatureDevChange: true,
    });
    const rows = readFeatureStageUnit(root, dirName);
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
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, dirName, adapter: 'claude-code' });
    }
    // An END with no START — the only development row present.
    endStage(root, 'development', {}, { sessionId, dirName, adapter: 'claude-code' });

    finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
      subjectDigest: 'sha256-orphan',
      isFeatureDevChange: true,
    });

    const rows = readFeatureStageUnit(root, dirName);
    // No inferred-git development row was added — the existing end already counts.
    expect(
      rows.some((r) => r.stage === 'development' && r.evidence_source === 'inferred-git'),
    ).toBe(false);
  });

  it('#310: does NOT infer a development row for a clean-tree change (no diff to anchor to)', () => {
    const sessionId = 'ses_backfill_clean';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, dirName, adapter: 'claude-code' });
    }
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 0,
      isFeatureDevChange: true,
    });
    // No working-tree delta → nothing honest to infer development from.
    const rows = readFeatureStageUnit(root, dirName);
    expect(rows.some((r) => r.evidence_source === 'inferred-git')).toBe(false);
    expect(result?.missing_stages).toContain('development');
  });

  it('#321: re-verifies an incomplete change at each Stop (no verify-once early return)', () => {
    const sessionId = 'ses_reverify';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId, dirName, adapter: 'claude-code' });
    endStage(root, 'planning', provenEndArgs(root, 'planning'), {
      sessionId,
      dirName,
      adapter: 'claude-code',
    });

    const first = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(first?.ok).toBe(false); // planning-only → incomplete, stays open
    const verifyCountAfterFirst = readFeatureStageUnit(root, dirName).filter(
      (row) => row.kind === 'verify',
    ).length;

    // A later Stop with no new work re-verifies (the change is still open, not closed).
    const second = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(second).not.toBeNull();
    const verifyCountAfterSecond = readFeatureStageUnit(root, dirName).filter(
      (row) => row.kind === 'verify',
    ).length;
    expect(verifyCountAfterSecond).toBeGreaterThan(verifyCountAfterFirst);
  });

  it('#321: a passing change writes a close row, clears the active feature, and later Stops no-op', () => {
    const sessionId = 'ses_close';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of [
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(root, stage), {
        sessionId,
        dirName,
        adapter: 'claude-code',
      });
    }

    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(result?.ok).toBe(true);
    // A `close` row brackets the passing change, and the active feature is cleared.
    const rows = readFeatureStageUnit(root, dirName);
    expect(rows.some((row) => row.kind === 'close')).toBe(true);
    expect(currentFeature(root, sessionId)).toBeNull();

    // A later Stop with no new change opened → nothing to finalize.
    const after = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 0,
    });
    expect(after).toBeNull();
  });

  it('#321: change B opens a FRESH feature after A closed (no free-riding)', () => {
    const sessionId = 'ses_two_changes';
    // Change A: full pass → closes.
    const { dirName: a } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of [
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, dirName: a, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(root, stage), {
        sessionId,
        dirName: a,
        adapter: 'claude-code',
      });
    }
    finalizeStageEvidence(root, { adapter: ADAPTER, sessionId, changedFilesCount: 1 });
    expect(currentFeature(root, sessionId)).toBeNull();

    // Change B: the next stage_start auto-opens a FRESH feature, not A.
    startStage(root, 'planning', { sessionId, adapter: 'claude-code' });
    const b = currentFeature(root, sessionId);
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
  });
});
