import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { foldFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { hudSnapshotPath } from '@/hud/files.js';
import { writeHudSnapshotSafe } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { finalizeStageEvidence } from '@/stage-evidence/finalize.js';
import { recordLiveStageEdits } from '@/stage-evidence/live-writer.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

import { buildDesktopBand } from '../../runtime/claude-plugin/mod/desktop-view.ts';
import { IDLE_LIVE } from '../../runtime/claude-plugin/mod/live.ts';
import { parseSnapshot } from '../../runtime/claude-plugin/mod/model.ts';

const SESSION = 'ses-edit-sequence';
const SEQUENCE = ['src/a.ts', 'SECURITY.md', 'src/manifest-build.ts', 'tests/a.test.ts'];
const NOW = Date.parse('2026-10-22T15:00:00.000Z');

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function fastChange(): { root: string; dirName: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-edit-sequence-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  const dirName = openFeatureChange(root, SESSION, {
    adapter: 'claude-code',
    title: 'Plugin directory readiness',
    lane: 'fast',
  });
  persistLedgerSessionId(root, SESSION);
  writeWorkflowState(root, SESSION, {
    active: { workflow: 'feature-development', lane: 'fast', reason: 'owner-specified change' },
    paused: [],
  });
  const ctx = { sessionId: SESSION, adapter: 'claude-code' };
  const plan = featureFilePath(dirName, 'plan');
  mkdirSync(join(root, dirname(plan)), { recursive: true });
  writeFileSync(join(root, plan), '{"steps":[]}\n');
  startStage(root, 'planning', ctx);
  endStage(root, 'planning', { artifactPaths: [plan] }, ctx);
  return { root, dirName };
}

function editAndDraw(root: string, path: string, editing: boolean) {
  recordLiveStageEdits({
    projectRoot: root,
    sessionId: SESSION,
    toolName: 'Edit',
    targetPaths: [path],
  });
  writeHudSnapshotSafe(root, SESSION, 'pre-tool-use');
  const snapshot = parseSnapshot(readFileSync(hudSnapshotPath(root, SESSION), 'utf8'))!;
  const live = editing
    ? { ...IDLE_LIVE, turnId: 't', editing: { toolUseId: 'tu', file: join(root, path) } }
    : IDLE_LIVE;
  const band = buildDesktopBand({
    snapshot,
    unbound: false,
    unavailable: false,
    now: NOW,
    turnStartedAt: null,
    live,
    visibility: { minimised: false, closed: false, hidden: false },
    menuOpen: false,
    columns: 93,
    maxRows: 12,
  });
  const running = snapshot.stages.filter((stage) => stage.state === 'running');
  return { snapshot, band, running: running.map((stage) => stage.stage) };
}

describe('a fast-lane change that edits src, a root policy file, src again and tests', () => {
  it('shows Build then Checks, never Docs, keeps Edit current, and ends complete once each open stage is ended', () => {
    const { root, dirName } = fastChange();
    const drawn = SEQUENCE.map((path) => ({ path, ...editAndDraw(root, path, false) }));

    expect(drawn.map((step) => step.running)).toEqual([
      ['development'],
      ['development'],
      ['development'],
      ['development', 'checks'],
    ]);
    for (const { band, snapshot } of drawn) {
      expect(snapshot.lane_stages).toEqual(['planning', 'development', 'checks']);
      expect(band.kind).toBe('feature');
      if (band.kind !== 'feature') continue;
      expect(band.headline.text).not.toBe('Syncing the docs');
      expect(band.strip.stages.map((stage) => stage.label)).toEqual(['Plan', 'Build', 'Checks']);
      expect(band.strip.delivery[0]).toEqual({ label: 'Edit', state: 'run' });
    }

    const turnEnd = {
      adapter: 'claude-code',
      sessionId: SESSION,
      changedFilesCount: SEQUENCE.length,
      deferClose: true,
    };
    const leftOpen = finalizeStageEvidence(root, turnEnd);
    expect(leftOpen?.open_stages).toEqual(['development', 'checks']);
    expect(leftOpen?.ok).toBe(false);
    for (const stage of ['development', 'checks']) {
      endStage(root, stage, {}, { sessionId: SESSION, adapter: 'claude-code' });
    }

    const finished = finalizeStageEvidence(root, turnEnd);
    expect(finished?.missing_stages).toEqual([]);
    const fold = foldFeature(root, SESSION, dirName);
    expect(fold.completeness.verdict).toBe('complete');
    expect(fold.stages.find((stage) => stage.stage === 'documentation_sync')?.state).toBe(
      'not-applicable',
    );
  });

  it('keeps Edit current while a file is being edited after Build has ended', () => {
    const { root } = fastChange();
    editAndDraw(root, 'src/a.ts', false);
    endStage(root, 'development', {}, { sessionId: SESSION, adapter: 'claude-code' });
    const { band } = editAndDraw(root, 'package.json', true);
    expect(band.kind === 'feature' && band.strip.delivery[0]).toEqual({
      label: 'Edit',
      state: 'run',
    });
  });
});
