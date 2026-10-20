import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '@/cli/index.js';
import { getOrLoad } from '@/context/tokenizer-cache.js';
import { appendRuleRun } from '@/feature-evidence/bundle-ledgers.js';
import { featureSessionControlPath } from '@/feature-evidence/paths.js';
import { readAllFeatureRuleRuns } from '@/feature-evidence/projections.js';

import {
  aggregateFootprint,
  discoverFootprintFiles,
  // @ts-expect-error -- pure JS helper shared with the runnable measure-footprint.mjs script
} from '../../scripts/lib/footprint.mjs';
import {
  bucketFindings,
  // @ts-expect-error -- pure JS helper shared with the runnable rule-findings-stats.mjs script
} from '../../scripts/lib/findings-stats.mjs';
import { seedDetectionFixtures } from '../shared/detection-fixtures.js';

describe('benchmark scripts on a fresh onboarded fixture', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-bench-'));
    seedDetectionFixtures(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('measures a non-zero resident footprint with a positive reduction vs the full rule tree', async () => {
    const projectRoot = join(root, 'new-react');
    await runCli([
      'node',
      'paqad-ai',
      'onboard',
      '--project-root',
      projectRoot,
      '--providers',
      'claude-code',
    ]);

    expect(existsSync(join(projectRoot, 'docs/instructions/rules'))).toBe(true);

    const records = discoverFootprintFiles(projectRoot);
    const areas = new Set(records.map((r: { area: string }) => r.area));
    expect(areas.has('rules-manifest')).toBe(true);
    expect(areas.has('rules')).toBe(true);
    expect(records.some((r: { area: string; kind: string }) => r.area === 'entry')).toBe(true);

    const tokenizer = await getOrLoad('Xenova/gpt2');
    const aggregate = aggregateFootprint(records, (text: string) => tokenizer.countTokens(text));

    expect(aggregate.totals.resident.tokens).toBeGreaterThan(0);
    expect(aggregate.totals.full.tokens).toBeGreaterThan(aggregate.totals.resident.tokens);
    expect(aggregate.reduction.tokens).toBeGreaterThan(0);
    expect(aggregate.reduction.tokens).toBeLessThan(1);
  });

  it('reads weekly deterministic-findings stats from the per-feature rule-run bundles it wrote', async () => {
    const projectRoot = join(root, 'new-react');
    await runCli([
      'node',
      'paqad-ai',
      'onboard',
      '--project-root',
      projectRoot,
      '--providers',
      'claude-code',
    ]);

    expect(bucketFindings(readAllFeatureRuleRuns(projectRoot)).total_runs).toBe(0);

    const sessionId = 'ses_bench';
    const featureDir = 'PQD-1-bench-01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const control = join(projectRoot, featureSessionControlPath(sessionId));
    mkdirSync(dirname(control), { recursive: true });
    writeFileSync(
      control,
      JSON.stringify({
        schema_version: 1,
        doc_type: 'paqad.feature-session',
        session_id: sessionId,
        active: featureDir,
        paused: [],
        lane: null,
      }),
      'utf8',
    );

    appendRuleRun(projectRoot, sessionId, {
      kind: 'findings',
      counts: { deterministic: 3, heuristic: 1, skipped: 0 },
      blocking: false,
    });
    appendRuleRun(projectRoot, sessionId, {
      kind: 'findings',
      counts: { deterministic: 5, heuristic: 0, skipped: 2 },
      blocking: true,
    });

    const rows = readAllFeatureRuleRuns(projectRoot);
    const bucketed = bucketFindings(rows);

    expect(bucketed.total_runs).toBe(2);
    expect(bucketed.weeks).toHaveLength(1);
    expect(bucketed.weeks[0].max).toBe(5);
    expect(bucketed.weeks[0].runs).toBe(2);
  });
});
