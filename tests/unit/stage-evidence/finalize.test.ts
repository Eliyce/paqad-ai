import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdirSync } from 'node:fs';

import {
  closeVerifiedChange,
  endStage,
  finalizeStageEvidence,
  isArtifactBearingStage,
  openStageEvidence,
  startStage,
  type EndStageInput,
} from '@/stage-evidence/index.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

const ADAPTER = 'backstop';

function provenEndArgs(root: string, dirName: string, stage: string): EndStageInput {
  if (!isArtifactBearingStage(stage)) return {};
  const file = stage === 'planning' ? 'plan' : stage === 'specification' ? 'specification' : null;
  const rel = file ? featureFilePath(dirName, file) : `.paqad/artifacts/${stage}.md`;
  mkdirSync(join(root, dirname(rel)), { recursive: true });
  writeFileSync(join(root, rel), file ? '{"real":true}\n' : `# ${stage} artifact\n`);
  return { artifactPaths: [rel] };
}

function activeRows(root: string, sessionId: string) {
  const dir = currentFeature(root, sessionId);
  return dir ? readFeatureStageUnit(root, dir) : [];
}

describe('finalizeStageEvidence', () => {
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
      endStage(root, stage, provenEndArgs(root, dirName, stage), {
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
    expect(result?.ok).toBe(false);
    expect(result?.verdict).toBe('incomplete');
    const rows = activeRows(root, sessionId);
    const inferred = rows.find((row) => row.evidence_source === 'inferred-git');
    expect(inferred).toBeDefined();
    expect(inferred?.subject_digest).toBe('deadbeef');
  });

  it('swallows errors and returns null (best-effort, never breaks verification)', () => {
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
    startStage(root, 'development', { sessionId, dirName, adapter: 'claude-code' });

    finalizeStageEvidence(root, { adapter: ADAPTER, sessionId, changedFilesCount: 1 });

    const rows = activeRows(root, sessionId);
    const devEnd = rows.find((row) => row.kind === 'stage_end' && row.stage === 'development');
    expect(devEnd, 'the dangling stage should be closed at the turn boundary').toBeDefined();
    expect(devEnd?.evidence_source).toBe('live-mark');
    expect(rows.some((row) => row.evidence_source === 'inferred-git')).toBe(false);
  });

  it('ends a live-mark stage that was started again after an earlier end', () => {
    const sessionId = 'ses_reopened';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    const ctx = { sessionId, dirName, adapter: 'claude-code' };
    startStage(root, 'development', ctx);
    endStage(root, 'development', {}, ctx);
    startStage(root, 'development', ctx);

    finalizeStageEvidence(root, { adapter: ADAPTER, sessionId, changedFilesCount: 1 });

    const development = readFeatureStageUnit(root, dirName).filter(
      (row) => row.stage === 'development',
    );
    expect(development.map((row) => row.kind)).toEqual([
      'stage_start',
      'stage_end',
      'stage_start',
      'stage_end',
    ]);
  });

  it('anchors a review the agent left open, but an artifact-less review is inconclusive', () => {
    const sessionId = 'ses_late_review';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of [
      'planning',
      'specification',
      'development',
      'checks',
      'documentation_sync',
    ]) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(root, dirName, stage), {
        sessionId,
        dirName,
        adapter: 'claude-code',
      });
    }
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
    expect(reviewEnd, 'finalize should still anchor the open review at completion').toBeDefined();
    expect(reviewEnd?.evidence_source).toBe('live-mark');
  });

  it('a documentation-only change is a no-op (isFeatureDevChange=false) — code stages do not apply', () => {
    const sessionId = 'ses_docs_only';
    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 2,
      isFeatureDevChange: false,
    });
    expect(result).toBeNull();
    expect(currentFeature(root, sessionId)).toBeNull();
  });

  it('backfills an inferred development row when planning+spec were recorded but no development mark exists', () => {
    const sessionId = 'ses_backfill';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
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
    expect(result?.missing_stages).not.toContain('development');
  });

  it('does NOT backfill development when a development row already exists (even an orphan end)', () => {
    const sessionId = 'ses_backfill_orphan_end';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId, dirName, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId, dirName, adapter: 'claude-code' });
    }
    endStage(root, 'development', {}, { sessionId, dirName, adapter: 'claude-code' });

    finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
      subjectDigest: 'sha256-orphan',
      isFeatureDevChange: true,
    });

    const rows = readFeatureStageUnit(root, dirName);
    expect(
      rows.some((r) => r.stage === 'development' && r.evidence_source === 'inferred-git'),
    ).toBe(false);
  });

  it('does NOT infer a development row for a clean-tree change (no diff to anchor to)', () => {
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
    const rows = readFeatureStageUnit(root, dirName);
    expect(rows.some((r) => r.evidence_source === 'inferred-git')).toBe(false);
    expect(result?.missing_stages).toContain('development');
  });

  it('re-verifies an incomplete change at each Stop (no verify-once early return)', () => {
    const sessionId = 'ses_reverify';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId, dirName, adapter: 'claude-code' });
    endStage(root, 'planning', provenEndArgs(root, dirName, 'planning'), {
      sessionId,
      dirName,
      adapter: 'claude-code',
    });

    const first = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
    });
    expect(first?.ok).toBe(false);
    const verifyCountAfterFirst = readFeatureStageUnit(root, dirName).filter(
      (row) => row.kind === 'verify',
    ).length;

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

  it('a passing change writes a close row, clears the active feature, and later Stops no-op', () => {
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
      endStage(root, stage, provenEndArgs(root, dirName, stage), {
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
    const rows = readFeatureStageUnit(root, dirName);
    expect(rows.some((row) => row.kind === 'close')).toBe(true);
    expect(currentFeature(root, sessionId)).toBeNull();

    const after = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 0,
    });
    expect(after).toBeNull();
  });

  it('change B opens a FRESH feature after A closed (no free-riding)', () => {
    const sessionId = 'ses_two_changes';
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
      endStage(root, stage, provenEndArgs(root, a, stage), {
        sessionId,
        dirName: a,
        adapter: 'claude-code',
      });
    }
    finalizeStageEvidence(root, { adapter: ADAPTER, sessionId, changedFilesCount: 1 });
    expect(currentFeature(root, sessionId)).toBeNull();

    startStage(root, 'planning', { sessionId, adapter: 'claude-code' });
    const b = currentFeature(root, sessionId);
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
  });
  it('deferClose leaves a passing change open until closeVerifiedChange closes it', () => {
    const sessionId = 'ses_defer';
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
      endStage(root, stage, provenEndArgs(root, dirName, stage), {
        sessionId,
        dirName,
        adapter: 'claude-code',
      });
    }

    const result = finalizeStageEvidence(root, {
      adapter: ADAPTER,
      sessionId,
      changedFilesCount: 1,
      deferClose: true,
    });
    expect(result?.ok).toBe(true);
    expect(currentFeature(root, sessionId)).toBe(dirName);
    expect(readFeatureStageUnit(root, dirName).some((row) => row.kind === 'close')).toBe(false);

    closeVerifiedChange(root, { sessionId, adapter: ADAPTER, verdict: result!.verdict });
    const close = readFeatureStageUnit(root, dirName).filter((row) => row.kind === 'close');
    expect(close).toHaveLength(1);
    expect(close[0]!.note).toBe(`closed; verdict=${result!.verdict}`);
    expect(currentFeature(root, sessionId)).toBeNull();
  });

  it('closeVerifiedChange is a no-op when no change is active', () => {
    closeVerifiedChange(root, { sessionId: 'ses_idle', adapter: ADAPTER, verdict: 'complete' });
    expect(currentFeature(root, 'ses_idle')).toBeNull();
  });
  it('closeVerifiedChange swallows a write failure (best-effort, never breaks verification)', () => {
    const sessionId = 'ses_close_err';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: 'claude-code' });
    const ledger = join(root, featureDir(dirName), 'stage-evidence.jsonl');
    rmSync(ledger, { force: true });
    mkdirSync(ledger);
    expect(() =>
      closeVerifiedChange(root, { sessionId, adapter: ADAPTER, verdict: 'complete' }),
    ).not.toThrow();
  });
});
