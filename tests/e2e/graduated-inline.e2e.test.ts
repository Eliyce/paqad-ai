import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlanCommand } from '@/cli/commands/plan.js';
import { createStageCommand } from '@/cli/commands/stage.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { PATHS } from '@/core/constants/paths.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { writeFeatureReview, writeFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import type { BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { writePendingImpact } from '@/stage-evidence/pending-lane.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';
import {
  buildBundleCompletenessConfig,
  stageIsolationStatus,
} from '@/verification/repository/bundle-completeness-config.js';

const S = 'ses-graduated-inline';
const SPEC_MD = '# Small change\n\n- FR-1: does the small thing\n';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixtureProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-graduated-inline-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  return root;
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf8');
}

async function cli(
  command: ReturnType<typeof createStageCommand>,
  root: string,
  args: string[],
): Promise<string[]> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
  await command.parseAsync([...args, '--project-root', root, '--session', S], { from: 'user' });
  vi.restoreAllMocks();
  return lines;
}

const stage = (root: string, ...args: string[]) => cli(createStageCommand(), root, args);

function frozenSpec(): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-small',
    spec_file: 'spec.md',
    spec_hash: sha256Hex(SPEC_MD),
    behaviour: ['does the small thing'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: {
      frozen_at: '2026-10-29T12:00:00.000Z',
      spec_hash: sha256Hex(SPEC_MD),
      signed_off_by: 'me',
    },
  };
}

const INLINE_GATE_CONFIG: BundleCompletenessConfig = {
  lane: 'graduated',
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
  stageIsolationUnresolved: false,
};

async function runInlineChange(root: string): Promise<string> {
  const dir = openFeatureChange(root, S, {
    adapter: 'claude-code',
    title: 'ORD-900 small change',
    issue: 'ORD-900',
    lane: 'full',
  });
  persistLedgerSessionId(root, S);
  writeWorkflowState(root, S, {
    active: { workflow: 'feature-development', lane: 'full', reason: 'a classifier guess' },
    paused: [],
  });
  writePendingImpact(root, S, { database_impact: 'none', api_impact: 'none' });

  await stage(root, 'start', 'planning');
  const template = join(root, 'plan-input.json');
  writeFileSync(
    template,
    JSON.stringify({
      summary: 'a three-file change',
      steps: [{ id: 'S1', description: 'edit', files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }],
      reuse: {
        consulted: [{ source: 'grep', query: 'a', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
    }),
  );
  const planLines = await cli(createPlanCommand(), root, ['compile', template]);
  expect(planLines).toContain(
    '**▸ paqad** · lane set to graduated from full: the plan touches 3 files, none sensitive, no schema or breaking API change',
  );
  await stage(root, 'end', 'planning', '--artifact', featureFilePath(dir, 'plan'));

  await stage(root, 'start', 'specification');
  writeFeatureSpecification(root, S, frozenSpec(), SPEC_MD);
  await stage(root, 'end', 'specification', '--artifact', featureFilePath(dir, 'specification'));

  for (const edit of ['development', 'checks', 'documentation_sync']) {
    await stage(root, 'start', edit);
    await stage(root, 'end', edit);
  }

  await stage(root, 'start', 'review');
  writeFeatureReview(root, S, { summary: 'fine', verdict: 'safe-to-merge', rollback: 'revert' });
  await stage(root, 'end', 'review', '--artifact', featureFilePath(dir, 'review'));

  write(root, featureFilePath(dir, 'delivery'), '{}');
  write(root, featureFilePath(dir, 'evidence'), '{"code":"format"}\n');
  return dir;
}

describe('a small graduated change run inline end to end', () => {
  it('ends with a complete bundle, every stage recorded, and no stage helper rows', async () => {
    const root = fixtureProject();
    const dir = await runInlineChange(root);

    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'graduated', lane_source: 'plan' });
    const rows = readFeatureStageUnit(root, dir);
    for (const name of [
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]) {
      expect(rows.some((row) => row.kind === 'stage_start' && row.stage === name)).toBe(true);
      expect(rows.some((row) => row.kind === 'stage_end' && row.stage === name)).toBe(true);
    }
    expect(rows.some((row) => row.kind === STAGE_AGENT_KIND)).toBe(false);

    const built = buildBundleCompletenessConfig(root, S, dir);
    expect(built.stageIsolationExpected).toBe(false);
    const gate = bundleCompletenessGate({
      sessionId: S,
      origin: 'hook-completion',
      isFeatureDev: true,
      changeMetrics: null,
      projectRoot: root,
      dirName: dir,
      mode: 'strict',
      config: {
        ...INLINE_GATE_CONFIG,
        stageIsolationExpected: built.stageIsolationExpected,
        stageIsolationUnresolved: built.stageIsolationUnresolved,
      },
    });
    expect(gate!.status).toBe('pass');

    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.isolation?.status).toBe('not-applicable');
    expect(snapshot.flags.map((flag) => flag.id)).not.toContain('isolation-missing');
  });

  it('picks up again in a new session with no stage helpers expected', async () => {
    const root = fixtureProject();
    const dir = await runInlineChange(root);

    expect(stageIsolationStatus(root, 'ses-resumed', dir)).toBe('not-applicable');
    const lines = await stage(root, 'start', 'checks');
    expect(lines.some((line) => line.includes('lane raised'))).toBe(false);
    expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
    expect(buildBundleCompletenessConfig(root, 'ses-resumed', dir).stageIsolationExpected).toBe(
      false,
    );
  });
});
