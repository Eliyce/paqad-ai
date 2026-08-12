import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readAllFeatureChangeMetrics,
  readAllFeatureDuplication,
  readAllFeatureEvidence,
  readAllFeatureRuleRuns,
  readAllFeatureSpecifications,
  readAllFeatureStageRows,
} from '@/feature-evidence/projections.js';
import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendFeatureEvidenceRows,
  appendRuleRun,
} from '@/feature-evidence/bundle-ledgers.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { writeFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { sha256Hex } from '@/compliance/markdown.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

function frozenSpec(): FeatureSpec {
  const md = '# S-1\n\nExport as CSV.\n';
  return {
    schema_version: '1',
    spec_id: 'S-1',
    spec_file: 'docs/spec-sources/S-1.md',
    spec_hash: sha256Hex(md),
    behaviour: ['FR-1'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: { frozen_at: '2026-06-07T00:00:00Z', spec_hash: sha256Hex(md), signed_off_by: 'owner' },
  };
}

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
    expect(readAllFeatureSpecifications(root)).toEqual([]);
    expect(readAllFeatureDuplication(root)).toEqual([]);
    expect(readAllFeatureChangeMetrics(root)).toEqual([]);
    expect(readAllFeatureEvidence(root)).toEqual([]);
  });

  it('unions duplication, change-metrics, and evidence rows across feature dirs (#468)', () => {
    const root = tempRoot();
    const a = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'A',
      issue: null,
      ulidSeed: 1,
    });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'B',
      issue: null,
      ulidSeed: 2,
    });
    // Two features are open; the active one (b) receives the rows.
    appendDuplicationRun(root, 'ses_1', {
      schema_version: 1,
      generated_at: '2026-08-12T00:00:00.000Z',
      mode: 'warn',
      similarity_threshold: 0.8,
      min_lines: 5,
      elapsed_ms: 1,
      findings: [],
      counts: { deterministic: 0, heuristic: 1 },
      blocking: false,
    });
    appendChangeMetrics(root, 'ses_1', {
      dup_new_pct: 0,
      reuse_rate: 2,
      meaningful_changed_lines: 10,
      inputs: {
        flagged_lines: 0,
        reuse_calls: 2,
        duplication_report_present: true,
        index_present: true,
      },
    });
    appendFeatureEvidenceRows(root, 'ses_1', [
      buildEvidenceRow({
        ts: '2026-08-12T00:00:00.000Z',
        engine: 'verification-gate',
        code: 'code-tests-lint',
        subject_digest: 'sd',
        verdict: 'pass',
        strength_class: 'deterministic',
      }),
    ]);

    expect(readAllFeatureDuplication(root)).toHaveLength(1);
    expect(readAllFeatureChangeMetrics(root)).toHaveLength(1);
    expect(readAllFeatureEvidence(root)).toHaveLength(1);
    expect(readAllFeatureEvidence(root)[0]).toMatchObject({ code: 'code-tests-lint' });
    expect(a).not.toBe(b);
  });

  it('projects every FROZEN bundle specification and skips unfrozen/corrupt ones (#343 A1)', () => {
    const root = tempRoot();
    // A real active feature with a frozen specification.json.
    const good = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Good',
      issue: null,
      ulidSeed: 1,
    });
    writeFeatureSpecification(root, 'ses_1', frozenSpec());
    // A second feature dir whose specification.json is UNFROZEN — must be skipped.
    const bad = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'Bad',
      issue: null,
      ulidSeed: 2,
    });
    const unfrozenPath = join(root, featureFilePath(bad, 'specification'));
    mkdirSync(dirname(unfrozenPath), { recursive: true });
    writeFileSync(unfrozenPath, JSON.stringify({ ...frozenSpec(), frozen: null }), 'utf8');

    const specs = readAllFeatureSpecifications(root);
    expect(specs).toHaveLength(1);
    expect(specs[0].spec_id).toBe('S-1');
    expect(specs[0].frozen).not.toBeNull();
    expect(good).not.toBe(bad);
  });
});
