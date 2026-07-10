import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAllFeatureRuleRuns, readAllFeatureStageRows } from '@/feature-evidence/projections.js';
import { appendRuleRun } from '@/feature-evidence/bundle-ledgers.js';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-proj-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('whole-project projections from feature bundles', () => {
  it('unions stage-evidence rows across every feature dir', () => {
    const root = tempRoot();
    const a = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
      ulidSeed: 1,
    });
    appendFeatureStageRow(root, 'ses_1', a, {
      kind: 'stage_start',
      stage: 'planning',
      adapter: 'claude-code',
    });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'B',
      issue: null,
      ulidSeed: 2,
    });
    appendFeatureStageRow(root, 'ses_1', b, {
      kind: 'stage_start',
      stage: 'development',
      adapter: 'claude-code',
    });
    const rows = readAllFeatureStageRows(root);
    // Both features' open rows + the two stage_start rows.
    const stages = rows.filter((r) => r.kind === 'stage_start').map((r) => r.stage);
    expect(stages).toContain('planning');
    expect(stages).toContain('development');
  });

  it('unions rule-run rows across feature dirs', () => {
    const root = tempRoot();
    openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    appendRuleRun(root, 'ses_1', {
      kind: 'findings',
      counts: { deterministic: 1 },
      blocking: true,
    });
    const rows = readAllFeatureRuleRuns(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'findings', blocking: true });
  });

  it('returns [] when there are no feature dirs', () => {
    const root = tempRoot();
    expect(readAllFeatureStageRows(root)).toEqual([]);
    expect(readAllFeatureRuleRuns(root)).toEqual([]);
  });
});
