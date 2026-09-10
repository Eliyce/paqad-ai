// Issue #540 — the displacement path, end to end (AC-5).
//
// A background `<task-notification>` (a Monitor firing on a PR's CI) reaches the session
// as an ordinary user turn, so the short turn it produces ends in another Stop. The two
// retrospective seams then re-read state that belongs to a change which is already
// finished: the marker parser re-reads the whole transcript, and the git backstop re-reads
// the branch's working-tree delta. With the session pointer released by the close, both
// used to OPEN a fresh untitled `change-<ULID>` for that finished work — which stole the
// session pointer, picked up the real diff through the inferred-git row, and reported five
// missing stages for a change that had passed every one of them.
//
// Reproduced from the observed incident (session `b7c32628`, 2026-09-10): bundle
// `538-…-01M25QJ2VNWCDDPA1AY3FKRDDB` closed complete at 13:58:40Z, the notification landed
// at 14:00:08Z, and `change-01M25SX72YRJRD3HVAMB58FDB3` was minted at 14:00:22Z.

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

/** The transcript the agent actually leaves behind for a full six-stage change. */
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

/** End-stage args that satisfy the #320/#394 artifact requirement for a thinking stage. */
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

  /** Run a change to a passing verdict, exactly as the finalizer closes it. */
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
    // The close releases the session pointer — the precondition for the whole incident.
    expect(currentFeature(root, SESSION)).toBeNull();
    return dirName;
  }

  /**
   * The turn a notification produces: no edits, then both retrospective seams fire in
   * hook order (marker parse, then the completion backstop). Returns the verdict the
   * completion gate reached — the number the developer actually sees.
   */
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

    // The trust-inverting symptom: the gate used to judge the phantom and report
    // `incomplete` with every mandatory stage missing, for work that had just passed.
    // With nothing left to verify there is no verdict, so no gate is added and nothing
    // fails (`stageEvidenceGate(null, …)` returns null).
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
    // What `paqad-ai resume --feature 538` does. Before the fix this returned null,
    // because the control held neither the change nor anything else.
    expect(resumeFeatureByRef(root, SESSION, '538')).toBe(done);
    expect(currentFeature(root, SESSION)).toBe(done);
  });

  it('AC-2: resuming it pushes an outgoing active change onto the paused stack', () => {
    const done = completeChange();
    // A second change opened by a deliberate signal, the way a real next change starts.
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
    // No close on record, so both seams behave exactly as they did before this fix: the
    // markers open a bundle. This is what keeps the Codex and Gemini completion hooks —
    // which share these seams and have no PreToolUse writer — recording as before.
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

    // The guard only bites when NOTHING is active; with a bundle open the markers land in
    // it exactly as before.
    expect(readFeatureStageUnit(root, next).some((row) => row.kind === 'stage_start')).toBe(true);
  });
});
