import { afterEach, describe, expect, it } from 'vitest';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';
import { isArtifactBearingStage } from '@/stage-evidence/index.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import { buildHudSnapshot, gapStages } from '@/hud/snapshot.js';
import {
  UNRECORDED_STAGES_PREFIX,
  unrecordedStagesGap,
  unrecordedStagesOf,
} from '@/verification/verdict-kind.js';

import { buildDesktopBand, stageStrip } from '../../../runtime/claude-plugin/mod/desktop-view.ts';
import { parseSnapshot } from '../../../runtime/claude-plugin/mod/model.ts';
import { cleanupScopeFixtures, openChangeHere, repoRoot } from './scope-fixtures.js';

const S = 'ses-marks';

afterEach(() => cleanupScopeFixtures());

function closedRun(gaps: string[], noReport: boolean) {
  const root = repoRoot();
  const dir = openChangeHere(root, S);
  for (const stage of [
    'planning',
    'specification',
    'development',
    'review',
    'documentation_sync',
    'checks',
  ]) {
    const ctx = { sessionId: S, adapter: 'claude-code' };
    startStage(root, stage, ctx);
    const file = stage === 'planning' ? 'plan' : stage === 'specification' ? 'specification' : null;
    const rel = file ? featureFilePath(dir, file) : `.paqad/artifacts/${stage}.md`;
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), file ? '{"real":true}\n' : `# ${stage}\n`);
    endStage(root, stage, isArtifactBearingStage(stage) ? { artifactPaths: [rel] } : {}, ctx);
  }
  if (noReport) {
    appendFeatureStageRow(root, S, dir, {
      kind: 'stage-agent',
      stage: 'checks',
      agent: 'paqad-checks',
      event_status: 'completed',
      report_status: 'BLOCKED',
      report_source: 'none',
      report_stated: false,
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });
  }
  writeHudReceipt(
    root,
    S,
    {
      summary: 'receipt',
      receipt: 'receipt',
      gates: [],
      kind: 'inconclusive',
      work_kind: 'inconclusive',
      work_reasons: [],
      record_gaps: gaps.map((text) => ({
        code: 'unrecorded-mandatory-stages',
        text,
        detail: null,
      })),
    },
    () => new Date(Date.now() + 1000),
  );
  return parseSnapshot(JSON.stringify(buildHudSnapshot(root, S)))!;
}

const checksOf = (snapshot: NonNullable<ReturnType<typeof parseSnapshot>>) =>
  stageStrip(snapshot).stages.find((mark) => mark.label === 'Checks')?.state;

describe('AC-9: a stage named in the record gaps is drawn marked, never done', () => {
  it('reads the stage words back from the gap text', () => {
    expect([...gapStages(['No record yet for: Plan, Checks', 'other gap'])]).toEqual([
      'planning',
      'checks',
    ]);
  });

  it('draws Checks marked while the gap line names it, and the headline agrees', () => {
    const snapshot = closedRun(['No record yet for: Checks'], false);
    expect(snapshot.stages.find((stage) => stage.stage === 'checks')?.record_gap).toBe(true);
    expect(checksOf(snapshot)).toBe('marked');
    expect(snapshot.record_gaps).toContain('No record yet for: Checks');
    expect(snapshot.headline.word).not.toBe('Safe to merge');
    expect(stageStrip(snapshot).value).toBe('Checks marked: no record');
  });

  it('a stage the gaps do not name keeps its own state', () => {
    const snapshot = closedRun([], false);
    expect(snapshot.stages.find((stage) => stage.stage === 'checks')?.record_gap).toBeUndefined();
  });
});

describe('AC-18: a checks helper that gave no report shows it in caution', () => {
  it('shows Checks · helper gave no report', () => {
    const snapshot = closedRun([], true);
    expect(snapshot.stages.find((stage) => stage.stage === 'checks')?.no_report).toBe(true);
    expect(checksOf(snapshot)).toBe('marked');
    expect(stageStrip(snapshot).value).toBe('Checks · helper gave no report');
    const band = buildDesktopBand({
      snapshot,
      unbound: false,
      unavailable: false,
      now: Date.now(),
      turnStartedAt: null,
      visibility: { minimised: false, closed: false, hidden: false },
      menuOpen: false,
      columns: 93,
      maxRows: 12,
    });
    expect(JSON.stringify(band)).toContain('Checks · helper gave no report');
  });
});

describe("INV-5: the unrecorded-stages gap is read back with the writer's own words", () => {
  const ALL = [
    'ticket_intake',
    'planning',
    'specification',
    'development',
    'review',
    'checks',
    'documentation_sync',
    'delivery',
  ];

  it('AC-9: every stage the writer names comes back from gapStages', () => {
    const text = unrecordedStagesGap(ALL).text;
    expect(text.startsWith(UNRECORDED_STAGES_PREFIX)).toBe(true);
    expect(unrecordedStagesOf(text)).toEqual(ALL);
    expect([...gapStages([text])].sort()).toEqual([...ALL].sort());
    expect([...gapStages([unrecordedStagesGap(['review']).text])]).toEqual(['review']);
  });

  it('AC-9: any other gap text marks no stage', () => {
    expect(gapStages(['Lane not recorded', 'Review missing'])).toEqual(new Set());
  });
});
