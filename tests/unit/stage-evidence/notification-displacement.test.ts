import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import {
  currentFeature,
  foldFeature,
  readFeatureStageUnit,
  resumeFeatureByRef,
} from '@/feature-evidence/stage-ledger.js';
import {
  endStage,
  finalizeStageEvidence,
  isArtifactBearingStage,
  openStageEvidence,
  startStage,
  type EndStageInput,
} from '@/stage-evidence/index.js';
import { parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';

const SESSION = 'b7c32628-178b-4207-8973-276ea4a5edad';
const MANDATORY = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
] as const;

const TRANSCRIPT = MANDATORY.flatMap((stage) => [
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: `Starting ${stage}.\npaqad:stage ${stage} start` }],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: `Done.\npaqad:stage ${stage} end` }],
    },
  }),
]).join('\n');

function provenEndArgs(root: string, dirName: string, stage: string): EndStageInput {
  if (!isArtifactBearingStage(stage)) return {};
  const file = stage === 'planning' ? 'plan' : stage === 'specification' ? 'specification' : null;
  const rel = file ? featureFilePath(dirName, file) : `.paqad/artifacts/${stage}.md`;
  mkdirSync(join(root, dirname(rel)), { recursive: true });
  writeFileSync(join(root, rel), file ? '{"real":true}\n' : `# ${stage} artifact\n`);
  return { artifactPaths: [rel] };
}

describe('a background notification after a completed change (#540)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-540-displacement-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function completeChange(): string {
    const { dirName } = openStageEvidence(root, {
      sessionId: SESSION,
      adapter: 'claude-code',
      title: 'strip host-agent AI attribution from commits and PRs',
      issue: '538',
    });
    for (const stage of MANDATORY) {
      startStage(root, stage, { sessionId: SESSION, dirName, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(root, dirName, stage), {
        sessionId: SESSION,
        dirName,
        adapter: 'claude-code',
      });
    }
    const verdict = finalizeStageEvidence(root, {
      adapter: 'backstop',
      sessionId: SESSION,
      changedFilesCount: 7,
      subjectDigest: 'sha256-realdiff',
    });
    expect(verdict?.verdict).toBe('complete');
    expect(currentFeature(root, SESSION)).toBeNull();
    return dirName;
  }

  function notificationTurn() {
    parseAndRecordMarkers({ projectRoot: root, transcriptText: TRANSCRIPT, sessionId: SESSION });
    return finalizeStageEvidence(root, {
      adapter: 'backstop',
      sessionId: SESSION,
      changedFilesCount: 7,
      subjectDigest: 'sha256-realdiff',
    });
  }

  it('AC-1: creates no new feature-evidence bundle', () => {
    const done = completeChange();

    notificationTurn();

    expect(listFeatureDirs(root)).toEqual([done]);
    expect(currentFeature(root, SESSION)).toBeNull();
  });

  it('AC-1: stays quiet across repeated notifications, not just the first', () => {
    const done = completeChange();

    notificationTurn();
    notificationTurn();
    notificationTurn();

    expect(listFeatureDirs(root)).toEqual([done]);
  });

  it('AC-1: writes no row into the completed bundle either', () => {
    const done = completeChange();
    const before = readFeatureStageUnit(root, done).length;

    notificationTurn();

    expect(readFeatureStageUnit(root, done)).toHaveLength(before);
  });

  it('AC-4: the notification turn reports no failing verdict at all', () => {
    completeChange();

    expect(notificationTurn()).toBeNull();
  });

  it('AC-4: the completed change still folds complete', () => {
    const done = completeChange();

    notificationTurn();

    const fold = foldFeature(root, SESSION, done);
    expect(fold.completeness.verdict).toBe('complete');
    expect(fold.completeness.missing_stages).toEqual([]);
    expect(fold.completeness.ordering_violations).toEqual([]);
  });

  it('AC-3: the completed change is resumable with no hand-edit to the session file', () => {
    const done = completeChange();
    notificationTurn();
    expect(resumeFeatureByRef(root, SESSION, '538')).toBe(done);
    expect(currentFeature(root, SESSION)).toBe(done);
  });

  it('AC-2: resuming it pushes an outgoing active change onto the paused stack', () => {
    const done = completeChange();
    const next = openStageEvidence(root, {
      sessionId: SESSION,
      adapter: 'claude-code',
      title: 'something else',
      issue: '999',
    }).dirName;
    expect(currentFeature(root, SESSION)).toBe(next);

    expect(resumeFeatureByRef(root, SESSION, '538')).toBe(done);

    expect(readSessionControl(root, SESSION).paused).toContain(next);
  });

  it("does not suppress a session's FIRST change (the guard is session-scoped)", () => {
    parseAndRecordMarkers({ projectRoot: root, transcriptText: TRANSCRIPT, sessionId: SESSION });

    const opened = currentFeature(root, SESSION);
    expect(opened).not.toBeNull();
    expect(readFeatureStageUnit(root, opened!).some((row) => row.kind === 'stage_start')).toBe(
      true,
    );
  });

  it('does not suppress another session that has closed nothing', () => {
    completeChange();

    parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: TRANSCRIPT,
      sessionId: 'ses_other',
    });

    expect(currentFeature(root, 'ses_other')).not.toBeNull();
  });

  it('records markers again once a next change is deliberately opened', () => {
    completeChange();
    const next = openStageEvidence(root, {
      sessionId: SESSION,
      adapter: 'claude-code',
      title: 'the next change',
      issue: '541',
    }).dirName;

    parseAndRecordMarkers({ projectRoot: root, transcriptText: TRANSCRIPT, sessionId: SESSION });

    expect(readFeatureStageUnit(root, next).some((row) => row.kind === 'stage_start')).toBe(true);
  });
});
