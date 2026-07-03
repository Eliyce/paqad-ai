// Issue #285 AC2/AC3: the footprint and findings-stats scripts must be validated on a
// FRESH ONBOARDED fixture project (temp-dir onboard, the tests/e2e/onboarding pattern),
// not only on the paqad-ai repo. This drives the scripts' pure logic against a real
// onboarded tree using the same primitives the CLIs use (tokenizer-cache, readProjectEvents).

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '@/cli/index.js';
import { getOrLoad } from '@/context/tokenizer-cache.js';
import { readProjectEvents } from '@/session-ledger/project-ledger.js';
import { recordRuleFindings } from '@/rule-scripts/rule-ledger.js';

import {
  aggregateFootprint,
  discoverFootprintFiles,
  // @ts-expect-error -- pure JS helper shared with the runnable measure-footprint.mjs script
} from '../../scripts/lib/footprint.mjs';
import {
  bucketFindings,
  RULE_EVIDENCE_DOC_TYPE,
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
    // The lean slice split produced a resident manifest and the full tree is present.
    expect(areas.has('rules-manifest')).toBe(true);
    expect(areas.has('rules')).toBe(true);
    expect(records.some((r: { area: string; kind: string }) => r.area === 'entry')).toBe(true);

    // Real tokenizer via tokenizer-cache (falls back to the labelled heuristic offline).
    const tokenizer = await getOrLoad('Xenova/gpt2');
    const aggregate = aggregateFootprint(records, (text: string) => tokenizer.countTokens(text));

    expect(aggregate.totals.resident.tokens).toBeGreaterThan(0);
    // The full rule tree dwarfs the manifest floor, so paqad's resident load is smaller.
    expect(aggregate.totals.full.tokens).toBeGreaterThan(aggregate.totals.resident.tokens);
    expect(aggregate.reduction.tokens).toBeGreaterThan(0);
    expect(aggregate.reduction.tokens).toBeLessThan(1);
  });

  it('reads weekly deterministic-findings stats from the rule-evidence ledger it wrote', async () => {
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

    // No rows yet → "no data" shape.
    expect(bucketFindings(readProjectEvents(projectRoot, RULE_EVIDENCE_DOC_TYPE)).total_runs).toBe(
      0,
    );

    // Two fresh-run snapshots land on the ledger the stats script reads.
    recordRuleFindings(projectRoot, {
      counts: { deterministic: 3, heuristic: 1, skipped: 0 },
      blocking: false,
    });
    recordRuleFindings(projectRoot, {
      counts: { deterministic: 5, heuristic: 0, skipped: 2 },
      blocking: true,
    });

    const rows = readProjectEvents(projectRoot, RULE_EVIDENCE_DOC_TYPE);
    const bucketed = bucketFindings(rows);

    expect(bucketed.total_runs).toBe(2);
    expect(bucketed.weeks).toHaveLength(1);
    expect(bucketed.weeks[0].max).toBe(5);
    expect(bucketed.weeks[0].runs).toBe(2);
  });
});
