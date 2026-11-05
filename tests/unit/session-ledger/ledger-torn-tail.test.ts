import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { buildReport } from '@/dashboard/report.js';
import { exportFeatureBundle } from '@/feature-evidence/export.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { renderFeatureReportHtml } from '@/feature-evidence/report.js';
import { checkStageChain } from '@/feature-evidence/ledger-chain.js';
import {
  appendFeatureStageRow,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { setActiveFeature } from '@/feature-evidence/session-control.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { computeSessionRowHash, readUnitFileHealth } from '@/session-ledger/ledger.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

const DIR = 'mixed-01JABCDEFGHJKMNPQRSTVWXYZ0';
const SESSION = 'ses_mixed';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-mixed-'));
  roots.push(root);
  mkdirSync(join(root, featureDir(DIR)), { recursive: true });
  return root;
}

function v2Row(fields: Record<string, unknown>): string {
  const row: Record<string, unknown> = {
    schema_version: 2,
    doc_type: 'paqad.stage-evidence',
    change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    session_id: SESSION,
    recorded_at: '2026-11-01T10:00:00.000Z',
    agent: 'orchestrator',
    ...fields,
  };
  row.content_hash = computeSessionRowHash(row);
  return JSON.stringify(row);
}

function ledgerPath(root: string): string {
  return join(root, featureFilePath(DIR, 'stageEvidence'));
}

function mixedBundle(root: string): void {
  writeFileSync(
    ledgerPath(root),
    `${[
      v2Row({ kind: 'open' }),
      v2Row({ kind: 'stage_start', stage: 'planning' }),
      v2Row({ kind: 'stage_end', stage: 'planning', event_status: 'completed' }),
    ].join('\n')}\n`,
  );
  appendFeatureStageRow(root, SESSION, DIR, { kind: 'stage_start', stage: 'specification' });
  appendFeatureStageRow(root, SESSION, DIR, {
    kind: 'stage-handback',
    stage: 'specification',
    agent_id: 'a1',
    event_status: 'denied',
    tool_use_id: 't1',
    report_status: 'DONE',
    report_source: 'handback',
  });
}

describe('a ledger with a torn line', () => {
  it('AC-36: reads cleanly with torn_tail true and no other row lost', () => {
    const root = tempRoot();
    mixedBundle(root);
    const count = readFeatureStageUnit(root, DIR).length;
    appendFileSync(ledgerPath(root), '{"kind":"stage_end","sta');
    const health = readUnitFileHealth(root, featureFilePath(DIR, 'stageEvidence'));
    expect(health.torn_tail).toBe(true);
    expect(health.rows).toHaveLength(count);
    expect(readFeatureStageUnit(root, DIR)).toHaveLength(count);
  });

  it('reports no torn tail on a whole file, and skips a torn line left in the middle', () => {
    const root = tempRoot();
    mixedBundle(root);
    expect(readUnitFileHealth(root, featureFilePath(DIR, 'stageEvidence')).torn_tail).toBe(false);
    appendFileSync(ledgerPath(root), '{"cut\n');
    appendFeatureStageRow(root, SESSION, DIR, { kind: 'stage_end', stage: 'specification' });
    const health = readUnitFileHealth(root, featureFilePath(DIR, 'stageEvidence'));
    expect(health.torn_tail).toBe(false);
    expect(health.torn_lines).toBe(1);
  });

  it('treats a missing file as empty and whole', () => {
    expect(readUnitFileHealth(tempRoot(), 'none.jsonl')).toEqual({
      rows: [],
      torn_tail: false,
      torn_lines: 0,
    });
  });
});

const GATE_CONFIG = {
  lane: 'full',
  ruleComplianceOn: false,
  metricsEnabled: false,
  duplicationOn: false,
  featureReport: false,
  ragEnabled: false,
  enterprise: false,
  evidenceLedger: false,
  aiBom: false,
  specPipelineStrict: false,
  specPipelineEnabled: false,
  expertsEnabled: false,
  specFrozenBeforePipeline: false,
  stageIsolationExpected: false,
} as const;

describe('a bundle mixing version 2 and 3 rows', () => {
  it('AC-38: validates, folds, snapshots and renders with no error', () => {
    const root = tempRoot();
    mixedBundle(root);
    const rows = readFeatureStageUnit(root, DIR);
    expect(rows.map((row) => row.schema_version)).toEqual([2, 2, 2, 3, 3]);
    for (const row of rows) expect(validateStageEvidenceRow(row)).toEqual([]);
    const fold = foldFeature(root, SESSION, DIR);
    expect(fold.stages.find((stage) => stage.stage === 'planning')?.state).not.toBe('missing');
    setActiveFeature(root, SESSION, DIR, { lane: 'full' });
    writeWorkflowState(root, SESSION, {
      active: { workflow: 'feature-development' },
      paused: [],
    });
    const snapshot = buildHudSnapshot(root, SESSION);
    expect(snapshot.change?.dir).toBe(DIR);
    expect(snapshot.stages.find((stage) => stage.stage === 'planning')).toBeDefined();
    expect(snapshot.stages.find((stage) => stage.stage === 'specification')).toBeDefined();
    const bundle = exportFeatureBundle(root, DIR);
    const html = renderFeatureReportHtml(bundle, fold, { generatedAt: '2026-11-04' });
    expect(html).toContain('<html');
    expect(html).toContain('specification');
    writeFileSync(join(root, PATHS.ONBOARDING_MANIFEST), '{}\n');
    expect(buildReport(root).sections.length).toBeGreaterThan(0);
    const gate = bundleCompletenessGate({
      projectRoot: root,
      sessionId: SESSION,
      dirName: DIR,
      mode: 'strict',
      origin: 'hook-completion',
      isFeatureDev: true,
      config: GATE_CONFIG,
      changeMetrics: null,
    });
    expect(gate).not.toBeNull();
    expect(gate!.detail).not.toContain('chain broken');
  });

  it('AC-42: starts the chain at the first version 3 row', () => {
    const root = tempRoot();
    mixedBundle(root);
    const raw = readFileSync(ledgerPath(root), 'utf8');
    const check = checkStageChain(raw);
    expect(check.breaks).toEqual([]);
    expect(check.gaps).toEqual([]);
    const rows = readFeatureStageUnit(root, DIR);
    expect(rows[3]!.prev_hash).toBe(rows[2]!.content_hash);
  });
});

describe('checking the chain', () => {
  function lines(root: string): string[] {
    return readFileSync(ledgerPath(root), 'utf8').trimEnd().split('\n');
  }

  function chained(): string {
    const root = tempRoot();
    appendFeatureStageRow(root, SESSION, DIR, { kind: 'open' });
    for (const stage of ['planning', 'specification', 'review']) {
      appendFeatureStageRow(root, SESSION, DIR, { kind: 'stage_start', stage });
    }
    return root;
  }

  it('AC-80: names the row after one removed from the middle', () => {
    const all = lines(chained());
    const check = checkStageChain([all[0], all[2], all[3]].join('\n'));
    expect(check.breaks).toEqual([2]);
  });

  it('AC-42, AC-80: names the row when two rows swap', () => {
    const all = lines(chained());
    const check = checkStageChain([all[0], all[2], all[1], all[3]].join('\n'));
    expect(check.breaks.length).toBeGreaterThan(0);
  });

  it('AC-43: does not detect rows cut from the end, and the docs state that limit', () => {
    const all = lines(chained());
    expect(checkStageChain(all.slice(0, 2).join('\n')).breaks).toEqual([]);
    const doc = readFileSync(
      join(process.cwd(), 'docs/modules/feature-evidence/index/summary.md'),
      'utf8',
    );
    expect(doc).toContain('cannot see rows cut from the end of the file');
  });

  it('declares a late version 2 row and a torn line as gaps, not breaks', () => {
    const root = chained();
    appendFileSync(ledgerPath(root), `${v2Row({ kind: 'stage_end', stage: 'review' })}\n{"cut\n`);
    appendFeatureStageRow(root, SESSION, DIR, { kind: 'stage_end', stage: 'planning' });
    const check = checkStageChain(readFileSync(ledgerPath(root), 'utf8'));
    expect(check.breaks).toEqual([]);
    expect(check.gaps).toHaveLength(2);
  });

  describe('loss beside a gap', () => {
    const row = (fields: Record<string, unknown>) =>
      JSON.stringify({ schema_version: 3, ...fields });
    const start = row({ content_hash: 'a', prev_hash: null });
    const lost = row({ content_hash: 'lost', prev_hash: 'a' });
    const timeout = row({ content_hash: 'gap', prev_hash: null, chain_note: 'lock-timeout' });
    const after = row({ content_hash: 'b', prev_hash: 'lost' });

    it('still reads no break for a row deleted next to a lock-timeout gap, and says so', () => {
      const raw = [start, timeout, row({ content_hash: 'b', prev_hash: 'a' })].join('\n');
      const check = checkStageChain(raw);
      expect(check.breaks).toEqual([]);
      expect(check.blind_spot).toBe(
        'the chain does not vouch for rows beside a gap, so a row lost next to row 2 would not show',
      );
    });

    it('names the row when a gap row that chained to a lost row stays behind', () => {
      const torn = row({ content_hash: 'gap', prev_hash: 'lost', chain_note: 'after-torn-line' });
      const check = checkStageChain([start, torn].join('\n'));
      expect(check.gaps).toContain('row 2 does not follow the row before it, so a row may be lost');
    });

    it('still breaks when the deleted row sits between chained rows', () => {
      expect(checkStageChain([start, after].join('\n')).breaks).toEqual([2]);
      expect(checkStageChain([start, lost, after].join('\n')).blind_spot).toBeNull();
    });
  });

  it('accepts a row chaining past an adjacent declared gap', () => {
    const row = (fields: Record<string, unknown>) =>
      JSON.stringify({ schema_version: 3, ...fields });
    const raw = [
      row({ content_hash: 'a', prev_hash: null }),
      row({ content_hash: 'gap', prev_hash: null, chain_note: 'lock-timeout' }),
      row({ content_hash: 'b', prev_hash: 'a' }),
    ].join('\n');
    expect(checkStageChain(raw).breaks).toEqual([]);
  });
});
