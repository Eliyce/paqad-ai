import { afterEach, describe, expect, it } from 'vitest';

import type { ClassificationResult } from '@/core/types/classification.js';
import { closeActiveFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { buildHudSnapshot, type HudSnapshot } from '@/hud/snapshot.js';
import { runPromptRouteSeam } from '@/pipeline/prompt-lane.js';
import { writeRouteCorrection } from '@/pipeline/route-switch.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

import { cleanupScopeFixtures, repoRoot } from './scope-fixtures.js';

afterEach(cleanupScopeFixtures);

const S = 'ses-workflow-switches';

type Row = 'status row' | 'band with stage strip' | 'band' | 'getting ready' | 'closed row';

/** What the mod draws for a snapshot, in the words of AC-26 and AC-27. */
function rowOf(snapshot: HudSnapshot): Row | 'blank' {
  const route = snapshot.route;
  if (route === null || route === 'no-workflow') return 'blank';
  if (route !== 'feature-development') return 'status row';
  if ('closed_change' in snapshot && snapshot.closed_change) return 'closed row';
  if (snapshot.active) return snapshot.stages.length > 0 ? 'band with stage strip' : 'band';
  if (snapshot.scope.reason === 'closed') return 'closed row';
  return 'getting ready';
}

async function prompt(root: string, request: string, workflow: ClassificationResult['workflow']) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return runPromptRouteSeam(
    { projectRoot: root, request, sessionId: S, adapter: 'claude-code' },
    { classify: async () => ({ workflow }) as ClassificationResult },
  );
}

function stage(root: string, name: string, end = true): void {
  startStage(root, name, { sessionId: S, adapter: 'claude-code' });
  if (end) endStage(root, name, { artifactPaths: [] }, { sessionId: S, adapter: 'claude-code' });
}

describe('the HUD follows every workflow switch in one session (#902)', () => {
  it('AC-26: question, RCA, a corrected misroute, question, continue: no turn is blank', async () => {
    const root = repoRoot('fix/x');
    const rows: Array<Row | 'blank'> = [];

    await prompt(root, 'what does the router do?', 'project-question');
    rows.push(rowOf(buildHudSnapshot(root, S)));

    await prompt(root, 'find the root cause of the flaky build', 'root-cause-analysis');
    rows.push(rowOf(buildHudSnapshot(root, S)));

    await prompt(root, 'add a retry to the uploader', 'project-question');
    writeRouteCorrection(root, S, 'feature-development', { source: 'route-set' });
    openFeatureChange(root, S, { adapter: 'claude-code', title: 'retry uploader', lane: 'full' });
    persistLedgerSessionId(root, S);
    stage(root, 'planning');
    rows.push(rowOf(buildHudSnapshot(root, S)));

    await prompt(root, 'what does the uploader do today?', 'project-question');
    rows.push(rowOf(buildHudSnapshot(root, S)));

    const resumed = await prompt(root, 'continue', 'project-question');
    expect(resumed.narration).toContain('resumed');
    const last = buildHudSnapshot(root, S);
    rows.push(rowOf(last));

    expect(rows).toEqual([
      'status row',
      'status row',
      'band with stage strip',
      'status row',
      'band with stage strip',
    ]);
    expect(rows).not.toContain('blank');
  });

  it('AC-27: a first change closes and a second opens in one session, never blank', async () => {
    const root = repoRoot('fix/x');
    await prompt(root, 'build the exporter', 'feature-development');
    openFeatureChange(root, S, { adapter: 'claude-code', title: 'first change', lane: 'full' });
    persistLedgerSessionId(root, S);
    stage(root, 'planning');
    expect(rowOf(buildHudSnapshot(root, S))).toBe('band with stage strip');

    closeActiveFeature(root, S);
    const closed = buildHudSnapshot(root, S);
    expect(rowOf(closed)).not.toBe('blank');
    expect(['closed row', 'getting ready']).toContain(rowOf(closed));

    await prompt(root, 'now build the importer', 'feature-development');
    expect(rowOf(buildHudSnapshot(root, S))).toBe('getting ready');

    openFeatureChange(root, S, { adapter: 'claude-code', title: 'second change', lane: 'full' });
    stage(root, 'planning', false);
    expect(rowOf(buildHudSnapshot(root, S))).toBe('band with stage strip');
  });
});
