import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readFeatureRecord,
  seedFeatureRecord,
  writeFeatureRecord,
} from '@/feature-evidence/feature-record.js';
import type { BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import { featureDir } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

const DIR = '842-edges-01JABCDEFGHJKMNPQRSTVWXYA0';
const CONFIG: BundleCompletenessConfig = {
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
  stageIsolationExpected: true,
  stageIsolationUnresolved: false,
};

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function bundle(adapter = 'claude-code'): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recipe-proof-'));
  roots.push(root);
  mkdirSync(join(root, featureDir(DIR)), { recursive: true });
  seedFeatureRecord(root, DIR, { adapter, sessionId: 'ses_1', lane: 'full' });
  appendFeatureStageRow(root, 'ses_1', DIR, { kind: 'open' });
  return root;
}

const raiseLane = (root: string, from: string, to: string, offsetMs: number) => {
  writeFeatureRecord(root, DIR, {
    ...readFeatureRecord(root, DIR)!,
    lane_raised: {
      from,
      to,
      at: new Date(Date.now() + offsetMs).toISOString(),
      reason: 'grew',
      files: 9,
    } as never,
  });
};
const add = (root: string, row: Record<string, unknown>) =>
  appendFeatureStageRow(root, 'ses_1', DIR, row);
const gateDetail = (root: string, config = CONFIG): string =>
  bundleCompletenessGate({
    sessionId: 'ses_1',
    origin: 'hook-completion',
    isFeatureDev: true,
    changeMetrics: null,
    config,
    projectRoot: root,
    dirName: DIR,
    mode: 'strict',
  })!.detail ?? '';
const agentRow = (stage: string, extra: Record<string, unknown> = {}) => ({
  kind: 'stage-agent',
  stage,
  event_status: 'completed',
  agent_id: 'a1',
  tokens_used: 0,
  tokens_not_recarried: 0,
  estimate: true,
  ...extra,
});

describe('the recipe proof a full change must hold', () => {
  it('asks a stage with no agent row for that row first', () => {
    const root = bundle();
    add(root, { kind: 'stage_start', stage: 'development' });
    expect(gateDetail(root)).toContain(
      'The development stage has no proof its recipe was used: a stage-agent completed row is missing.',
    );
  });

  it('takes an agent that ran several stages as having run this one', () => {
    const root = bundle();
    add(root, { kind: 'stage_start', stage: 'specification' });
    add(root, agentRow('planning', { stages: ['planning', 'specification'] }));
    expect(gateDetail(root)).not.toContain('a stage-agent completed row is missing');
  });

  it('does not take a started agent for one that ran', () => {
    const root = bundle();
    add(root, { kind: 'stage_start', stage: 'development' });
    add(root, agentRow('development', { event_status: 'started' }));
    expect(gateDetail(root)).toContain('a stage-agent completed row is missing');
  });

  it('asks a Claude Code stage for its injection before its script', () => {
    const root = bundle();
    add(root, { kind: 'stage_start', stage: 'development' });
    add(root, agentRow('development'));
    expect(gateDetail(root)).toContain('a recipe-injected row is missing');
  });

  it('asks Codex checks for the digest of checks.json, not an injection', () => {
    const root = bundle('codex-cli');
    add(root, { kind: 'stage_start', stage: 'checks' });
    add(root, agentRow('checks'));
    add(root, { kind: 'stage_end', stage: 'checks' });
    const detail = gateDetail(root);
    expect(detail).toContain('an end row with the digest of checks.json is missing');
    expect(detail).not.toContain('a recipe-injected row is missing');
  });

  it('asks nothing of a stage that never started, or of any other lane', () => {
    const root = bundle();
    expect(gateDetail(root)).not.toContain('recipe proof for');
    add(root, { kind: 'stage_start', stage: 'development' });
    expect(gateDetail(root, { ...CONFIG, lane: 'fast' })).not.toContain('recipe proof for');
  });

  it('asks nothing of a stage that started before the lane rose to full', () => {
    const root = bundle();
    add(root, { kind: 'stage_start', stage: 'development' });
    raiseLane(root, 'graduated', 'full', 60_000);
    expect(gateDetail(root)).not.toContain('recipe proof for development');
  });

  it('still asks a stage that started after the lane rose', () => {
    const root = bundle();
    raiseLane(root, 'graduated', 'full', -60_000);
    add(root, { kind: 'stage_start', stage: 'development' });
    expect(gateDetail(root)).toContain('recipe proof for development');
  });

  it('still asks when the lane rose to something short of full', () => {
    const root = bundle();
    add(root, { kind: 'stage_start', stage: 'development' });
    raiseLane(root, 'fast', 'graduated', 60_000);
    expect(gateDetail(root)).toContain('recipe proof for development');
  });
});
